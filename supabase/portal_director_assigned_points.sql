begin;
alter table public.point_submissions add column if not exists director_assigned boolean not null default false;

create or replace function portal_private.assign_points(payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  person public.members%rowtype;
  director_id uuid;
  actor_name text;
  awarded integer := (payload->>'points_awarded')::integer;
  activity text := nullif(trim(payload->>'activity_name'),'');
  activity_day date := (payload->>'activity_date')::date;
  request_key uuid := (payload->>'request_id')::uuid;
  result_id uuid;
  previous public.point_submissions%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into person from public.members where id=(payload->>'member_id')::uuid for share;
  if not found then raise exception 'Trailblazer not found'; end if;
  if not portal_private.can_manage(person.cohort_id,'points') then raise exception 'Point assignment access required'; end if;
  if person.program_status <> 'active' then raise exception 'Points can only be assigned to active Trailblazers'; end if;
  if awarded is null or awarded not between 1 and 1000 or activity is null or length(activity)>200
     or activity_day is null or activity_day>(now() at time zone 'America/New_York')::date or request_key is null then
    raise exception 'Enter an activity, a valid date, and 1 to 1000 points';
  end if;
  -- Serialize retries of a single assignment, preventing duplicate awards.
  perform pg_advisory_xact_lock(hashtextextended(request_key::text,0));
  select * into previous from public.point_submissions where request_id=request_key;
  if found then
    if previous.director_assigned and previous.reviewed_by_user_id=auth.uid() and previous.member_id=person.id
      and previous.activity_name=activity and previous.points_requested=awarded and previous.activity_date=activity_day
      and previous.category is not distinct from nullif(trim(payload->>'category'),'')
      and previous.director_note is not distinct from nullif(trim(payload->>'director_note'),'') then
      return previous.id;
    end if;
    raise exception 'This assignment request was already used';
  end if;
  select id,first_name||' '||last_name into director_id,actor_name from public.directors where auth_user_id=auth.uid() and active limit 1;
  insert into public.point_submissions(member_id,activity_name,activity_date,description,category,points_requested,points_awarded,
    status,director_assigned,reviewed_by,reviewed_by_user_id,reviewer_name,reviewed_at,director_note,request_id)
  values(person.id,activity,activity_day,'Director assigned — no proof required.',nullif(trim(payload->>'category'),''),awarded,awarded,
    'approved',true,director_id,auth.uid(),coalesce(actor_name,'Portal administrator'),now(),nullif(trim(payload->>'director_note'),''),request_key)
  returning id into result_id;
  return result_id;
end $$;
create or replace function public.portal_assign_points(payload jsonb)
returns uuid language sql security invoker set search_path='' as $$ select portal_private.assign_points(payload); $$;
revoke all on function public.portal_assign_points(jsonb),portal_private.assign_points(jsonb) from public,anon;
grant execute on function public.portal_assign_points(jsonb),portal_private.assign_points(jsonb) to authenticated;

create or replace function portal_private.evidence_required()
returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
  if new.director_assigned then
    select cohort_id into cid from public.members where id=new.member_id;
    if auth.uid() is null or not portal_private.can_manage(cid,'points') or new.status<>'approved'
      or new.reviewed_by_user_id is distinct from auth.uid() or new.points_awarded is distinct from new.points_requested
      or new.points_awarded not between 1 and 1000 or new.evidence_path is not null
      or new.evidence_drive_file_id is not null or new.evidence_drive_url is not null then
      raise exception 'Invalid director point assignment';
    end if;
    return new;
  end if;
  if auth.uid() is not null and not exists(select 1 from storage.objects where bucket_id='trailblazers-private'
    and name=new.evidence_path and split_part(name,'/',1)=auth.uid()::text
    and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')) then
    raise exception 'Upload a JPG, PNG, or WebP picture with your submission';
  end if;
  return new;
end $$;
revoke all on function portal_private.evidence_required() from public,anon,authenticated;

create or replace function portal_private.inventory_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='point_submissions' then
  if tg_op='INSERT' and new.director_assigned then
    insert into public.member_notifications(member_id,notification_type,title,body,target_page,dedupe_key)
    values(new.member_id,'accountability','Director assigned points',new.reviewer_name||' assigned '||new.points_awarded||
      ' points for '||new.activity_name||'. No proof is required.','points','director-assigned:'||new.id);
  elsif tg_op='INSERT' then perform portal_private.queue_template(new.member_id,'point_received',to_jsonb(new),'point-received:'||new.id,'points');
  elsif new.status is distinct from old.status and new.status in ('approved','denied','needs_review') then
   perform portal_private.queue_template(new.member_id,'point_'||new.status,to_jsonb(new),'point-review:'||new.id||':'||new.status||':'||new.reviewed_at,'points');
  end if;
 elsif tg_table_name='strikes' then
  if tg_op='INSERT' then perform portal_private.queue_template(new.member_id,'strike_issued','{}','strike:'||new.id||':issued');
  elsif new.status is distinct from old.status then perform portal_private.queue_template(new.member_id,'strike_'||new.status,'{}','strike:'||new.id||':'||new.status); end if;
 elsif tg_table_name='members' and new.auth_user_id is not null and (tg_op='INSERT' or old.auth_user_id is null) then
  perform portal_private.queue_template(new.id,'welcome_member','{}','welcome:'||new.id);
 end if;
 return new;
end $$;
revoke all on function portal_private.inventory_notifications() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
