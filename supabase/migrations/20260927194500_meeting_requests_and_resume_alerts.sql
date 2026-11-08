alter table public.one_on_ones drop constraint if exists one_on_ones_status_check;
alter table public.one_on_ones add constraint one_on_ones_status_check
  check (status = any (array['not_scheduled','pending','scheduled','completed','reschedule_needed','denied','canceled']::text[]));

-- Keep the existing cohort/capability guard while allowing the member's request
-- and cancellation RPCs to transition an assigned meeting record.
do $migration$
declare definition text;
begin
  select pg_get_functiondef('portal_private.guard_write()'::regprocedure) into definition;
  if position($old$(to_jsonb(new)->>'status')::text='scheduled'$old$ in definition) = 0 then
    raise exception 'Expected one-on-one write guard clause was not found';
  end if;
  definition := replace(definition,
    $old$(to_jsonb(new)->>'status')::text='scheduled'$old$,
    $new$(to_jsonb(new)->>'status')::text in ('scheduled','pending','canceled')$new$);
  definition := replace(definition,
    $old$(to_jsonb(old)->>'status')::text not in ('completed','canceled')$old$,
    $new$(to_jsonb(old)->>'status')::text<>'completed'$new$);
  execute definition;
end
$migration$;

create or replace function public.schedule_my_one_on_one(
  p_one_on_one_id uuid,
  p_scheduled_date timestamptz,
  p_meeting_method text,
  p_location_method text default null
) returns void
language plpgsql security definer set search_path=public as $function$
declare v_member_id uuid; v_record_member_id uuid; v_status text;
begin
  select id into v_member_id from public.members where auth_user_id=auth.uid() limit 1;
  if v_member_id is null then raise exception 'No member profile is linked to this account.'; end if;
  select member_id,status into v_record_member_id,v_status from public.one_on_ones where id=p_one_on_one_id for update;
  if v_record_member_id is null then raise exception 'One-on-one record not found.'; end if;
  if v_record_member_id<>v_member_id then raise exception 'You cannot schedule this one-on-one.'; end if;
  if v_status='completed' then raise exception 'Completed one-on-ones cannot be changed.'; end if;
  if p_scheduled_date is null or p_scheduled_date<=now() then raise exception 'Choose a future date and time.'; end if;
  if p_meeting_method not in ('in_person','virtual','phone','other') then raise exception 'Invalid meeting method.'; end if;
  update public.one_on_ones set status='pending',scheduled_date=p_scheduled_date,meeting_method=p_meeting_method,
    location_method=nullif(trim(p_location_method),''),scheduled_by_user_id=auth.uid(),updated_at=now()
    where id=p_one_on_one_id;
end;
$function$;

create or replace function public.director_respond_one_on_one(p_one_on_one_id uuid,p_decision text)
returns void language plpgsql security definer set search_path=public as $function$
declare meeting public.one_on_ones; assignment public.director_assignments;
begin
  if p_decision not in ('accept','deny') then raise exception 'Choose accept or deny.'; end if;
  select * into meeting from public.one_on_ones where id=p_one_on_one_id for update;
  if not found or meeting.status<>'pending' then raise exception 'This request is no longer waiting for a response.'; end if;
  select a.* into assignment from public.director_assignments a join public.directors d on d.id=a.director_id
    where a.id=meeting.director_assignment_id and a.director_id=meeting.director_id and d.auth_user_id=auth.uid()
      and d.active and a.active and 'meetings'=any(a.capabilities)
      and (a.start_date is null or a.start_date<=current_date) and (a.end_date is null or a.end_date>=current_date);
  if assignment.id is null then raise exception 'Active meeting permission for this cohort is required.'; end if;
  update public.one_on_ones set status=case when p_decision='accept' then 'scheduled' else 'denied' end,updated_at=now()
    where id=p_one_on_one_id;
end;
$function$;

create or replace function public.member_cancel_one_on_one(p_one_on_one_id uuid)
returns void language plpgsql security definer set search_path=public as $function$
declare v_member_id uuid; meeting public.one_on_ones;
begin
  select id into v_member_id from public.members where auth_user_id=auth.uid() and program_status='active' limit 1;
  if v_member_id is null then raise exception 'An active member account is required.'; end if;
  select * into meeting from public.one_on_ones where id=p_one_on_one_id and member_id=v_member_id for update;
  if not found then raise exception 'One-on-one record not found.'; end if;
  if meeting.status not in ('pending','scheduled') then raise exception 'Only pending or scheduled one-on-ones can be canceled.'; end if;
  update public.one_on_ones set status='canceled',updated_at=now() where id=p_one_on_one_id;
end;
$function$;

create or replace function public.enqueue_one_on_one_notification()
returns trigger language plpgsql security definer set search_path=public as $function$
begin
  if new.status='pending' then
    insert into public.member_notifications(member_id,notification_type,title,body,target_page)
    values(new.member_id,'one_on_one','One-on-one request sent','Your request is waiting for your director to approve it.','oneonones');
  elsif new.status='scheduled' then
    insert into public.member_notifications(member_id,notification_type,title,body,target_page)
    values(new.member_id,'one_on_one',case when tg_op='INSERT' then 'New one-on-one scheduled' else 'One-on-one approved or updated' end,
      'Your one-on-one is scheduled for '||to_char(new.scheduled_date at time zone 'America/New_York','Mon FMDD at FMHH12:MI AM')||'.','oneonones');
  elsif new.status='denied' and (tg_op='INSERT' or old.status is distinct from new.status) then
    insert into public.member_notifications(member_id,notification_type,title,body,target_page)
    values(new.member_id,'one_on_one','One-on-one request not approved','Your director could not approve this time. Choose another time and send a new request.','oneonones');
  elsif new.status='canceled' and (tg_op='INSERT' or old.status is distinct from new.status) then
    insert into public.member_notifications(member_id,notification_type,title,body,target_page)
    values(new.member_id,'one_on_one','One-on-one canceled','Your one-on-one was canceled. You can request another time from the portal.','oneonones');
  end if;
  return new;
end;
$function$;

create or replace function public.enqueue_director_workflow_alert()
returns trigger language plpgsql security definer set search_path=public as $function$
declare m public.members; d public.directors; stamp text;
begin
  if tg_table_name='resume_submissions' then
    select * into m from public.members where id=new.member_id;
    for d in select distinct director.* from public.directors director join public.director_assignments a on a.director_id=director.id
      where a.cohort_id=m.cohort_id and a.active and director.active and 'resumes'=any(a.capabilities)
        and (a.start_date is null or a.start_date<=current_date) and (a.end_date is null or a.end_date>=current_date)
    loop
      insert into public.director_notifications(director_id,title,body,dedupe_key)
      values(d.id,'Resume ready for review',coalesce(m.preferred_name,m.first_name)||' '||m.last_name||' submitted a resume for review.',
        'resume-review:'||new.id||':'||d.id) on conflict(dedupe_key) do nothing;
    end loop;
  elsif new.status='pending' and (tg_op='INSERT' or old.status is distinct from new.status or old.scheduled_date is distinct from new.scheduled_date) then
    select * into m from public.members where id=new.member_id;
    select * into d from public.directors where id=new.director_id and active;
    if d.id is not null and exists(select 1 from public.director_assignments a where a.id=new.director_assignment_id
      and a.director_id=d.id and a.active and 'meetings'=any(a.capabilities)
      and (a.start_date is null or a.start_date<=current_date) and (a.end_date is null or a.end_date>=current_date)) then
      stamp:=coalesce(new.scheduled_date::text,'no-date');
      insert into public.director_notifications(director_id,title,body,dedupe_key)
      values(d.id,'One-on-one request waiting for you',coalesce(m.preferred_name,m.first_name)||' '||m.last_name||
        ' requested a one-on-one for '||to_char(new.scheduled_date at time zone 'America/New_York','Mon FMDD at FMHH12:MI AM')||'. Open the director portal to accept or deny it.',
        'one-on-one-request:'||new.id||':'||stamp) on conflict(dedupe_key) do nothing;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists resume_review_notify_directors on public.resume_submissions;
create trigger resume_review_notify_directors after insert on public.resume_submissions
for each row execute function public.enqueue_director_workflow_alert();
drop trigger if exists one_on_one_notify_director on public.one_on_ones;
create trigger one_on_one_notify_director after insert or update of status,scheduled_date on public.one_on_ones
for each row execute function public.enqueue_director_workflow_alert();

revoke all on function public.director_respond_one_on_one(uuid,text) from public,anon;
revoke all on function public.member_cancel_one_on_one(uuid) from public,anon;
grant execute on function public.director_respond_one_on_one(uuid,text) to authenticated;
grant execute on function public.member_cancel_one_on_one(uuid) to authenticated;
notify pgrst,'reload schema';
