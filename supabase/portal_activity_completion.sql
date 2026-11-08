-- Four required activities and six electives; retrospective meeting approval.
begin;
alter table public.point_rules add column if not exists is_required boolean not null default false;
alter table public.point_rules add column if not exists required_count integer not null default 1 check(required_count between 1 and 100);
alter table public.point_rules add column if not exists completion_source text not null default 'submission' check(completion_source in ('submission','director_meetings'));
alter table public.point_submissions add column if not exists point_rule_id uuid references public.point_rules(id) on delete restrict;
alter table public.point_submissions add column if not exists occurrence_count integer not null default 1 check(occurrence_count between 1 and 100);
create index if not exists point_submissions_activity_progress on public.point_submissions(member_id,point_rule_id,activity_date) where status='approved' and removed_at is null;
update public.point_rules set is_required=category='Required',required_count=case
 when name='Attend at least 3 NSBE General Body Meetings' then 3
 when name='Attend at least 2 NSBE events outside GBMs' then 2
 when name='Hangouts with 4 or 5 directors' then 4 else 1 end,
 completion_source=case when name='Hangouts with 4 or 5 directors' then 'director_meetings' else 'submission' end;
-- Preserve the meaning of existing submissions for a whole activity.
update public.point_submissions p set point_rule_id=r.id,occurrence_count=r.required_count
from public.point_rules r,public.members m where m.id=p.member_id and (r.cohort_id=m.cohort_id or r.cohort_id is null)
 and lower(trim(p.activity_name))=lower(trim(r.name)) and p.point_rule_id is null;

create or replace function portal_private.validate_point_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare rule public.point_rules; cid uuid;
begin
 if new.point_rule_id is null then return new; end if;
 select * into rule from public.point_rules where id=new.point_rule_id;
 select cohort_id into cid from public.members where id=new.member_id;
 if rule.id is null or (rule.cohort_id is not null and rule.cohort_id<>cid) then raise exception 'Choose an activity for this class'; end if;
 if new.occurrence_count not between 1 and rule.required_count then raise exception 'Check the number of completed events'; end if;
 if tg_op='INSERT' or new.point_rule_id is distinct from old.point_rule_id then
  if not rule.active then raise exception 'Choose an active activity'; end if;
  if rule.completion_source='director_meetings' then raise exception 'Check off director one-on-ones in the meetings screen; the group earns one point automatically'; end if;
 end if;
 new.activity_name:=rule.name;new.category:=rule.category;
 return new;
end $$;

-- Ledger corrections can classify historical free-text submissions too.
do $$declare source text; updated text;begin
 select pg_get_functiondef('portal_private.edit_points(uuid,jsonb)'::regprocedure) into source;
 updated:=replace(source,'category=nullif(trim(payload->>''category''),''''),status=desired,',
 'point_rule_id=case when payload ? ''point_rule_id'' then nullif(payload->>''point_rule_id'','''')::uuid else point_rule_id end, occurrence_count=coalesce((payload->>''occurrence_count'')::integer,occurrence_count), category=nullif(trim(payload->>''category''),''''),status=desired,');
 if updated=source then raise exception 'Could not extend ledger corrections'; end if;
 execute updated;
end $$;
revoke all on function portal_private.validate_point_activity() from public,anon,authenticated;
create trigger portal_activity_check before insert or update on public.point_submissions for each row execute function portal_private.validate_point_activity();

-- Extend the existing upload endpoint without changing its file ownership checks.
do $$declare source text; updated text;begin
 select pg_get_functiondef('portal_private.submit_file(text,text,text,jsonb)'::regprocedure) into source;
 updated:=replace(source,'category,evidence_path,request_id)','category,evidence_path,request_id,point_rule_id,occurrence_count)');
 updated:=replace(updated,'path,(payload->>''request_id'')::uuid)',
 'path,(payload->>''request_id'')::uuid,nullif(payload->>''point_rule_id'','''')::uuid,coalesce((payload->>''occurrence_count'')::integer,1))');
 if updated=source then raise exception 'Could not extend the point upload endpoint'; end if;
 execute updated;
end $$;

create or replace function portal_private.review_activity(record_id uuid,payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.point_submissions; cid uuid;begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into p from public.point_submissions where id=record_id for update;
 select cohort_id into cid from public.members where id=p.member_id and program_status='active';
 if cid is null or not portal_private.can_manage(cid,'points') then raise exception 'Point review access required'; end if;
 if p.status not in ('pending','needs_review') or p.removed_at is not null then raise exception 'Already reviewed. Refresh the queue.'; end if;
 if nullif(payload->>'point_rule_id','') is null and payload->>'status'='approved' then raise exception 'Select the activity being completed'; end if;
 update public.point_submissions set point_rule_id=nullif(payload->>'point_rule_id','')::uuid,
 occurrence_count=coalesce((payload->>'occurrence_count')::integer,1) where id=record_id;
 return portal_private.mutate('points_review',record_id,payload||jsonb_build_object('points_awarded',1));
end $$;
create or replace function public.portal_review_activity(record_id uuid,payload jsonb) returns uuid
language sql security invoker set search_path='' as $$ select portal_private.review_activity(record_id,payload); $$;

create or replace function portal_private.record_activity(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.point_rules; result uuid; previous public.point_submissions; events integer:=(payload->>'occurrence_count')::integer;begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into r from public.point_rules where id=(payload->>'point_rule_id')::uuid;
 if r.id is null or not r.active or r.completion_source<>'submission' or events is null or events not between 1 and r.required_count then raise exception 'Choose an activity and a valid event count'; end if;
 perform pg_advisory_xact_lock(hashtextextended(payload->>'request_id',0));
 select * into previous from public.point_submissions where request_id=(payload->>'request_id')::uuid;
 if previous.id is not null and (previous.point_rule_id is distinct from r.id or previous.occurrence_count<>events) then raise exception 'This assignment request was already used'; end if;
 result:=portal_private.assign_points(payload||jsonb_build_object('activity_name',r.name,'category',r.category,'points_awarded',1));
 update public.point_submissions set point_rule_id=r.id,occurrence_count=events where id=result;
 return result;
end $$;
create or replace function public.portal_record_activity(payload jsonb) returns uuid
language sql security invoker set search_path='' as $$ select portal_private.record_activity(payload); $$;

create or replace function portal_private.activity_progress(mid uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid; required_done integer; elective_done integer; configured integer; director_count integer; director_target integer;
 term_start date:=make_date(extract(year from now() at time zone 'America/New_York')::integer,case when extract(month from now() at time zone 'America/New_York')<=6 then 1 else 7 end,1);
begin
 select cohort_id into cid from public.members where id=mid;
 select count(distinct a.director_id) into director_target from public.director_assignments a join public.directors d on d.id=a.director_id
 where a.cohort_id=cid and a.active and d.active and (a.start_date is null or a.start_date<=current_date) and (a.end_date is null or a.end_date>=current_date);
 director_target:=least(5,greatest(4,director_target));
 select count(distinct director_id) into director_count from public.one_on_ones where member_id=mid and status='completed'
 and (completed_date at time zone 'America/New_York')::date>=term_start and completed_date<=now();
 select count(*) filter(where r.is_required), count(*) filter(where r.is_required and x.done),count(*) filter(where not r.is_required and x.done)
 into configured,required_done,elective_done from public.point_rules r cross join lateral
 (select case when r.completion_source='director_meetings' then director_count>=director_target else
 coalesce((select sum(p.occurrence_count) from public.point_submissions p where p.member_id=mid and p.point_rule_id=r.id and p.status='approved'
 and p.points_awarded>0 and p.removed_at is null and p.activity_date>=term_start and p.activity_date<=current_date),0)>=r.required_count end done)x
 where r.active and (r.cohort_id is null or r.cohort_id=cid);
 return jsonb_build_object('requiredComplete',required_done,'electiveComplete',elective_done,'approved',required_done+elective_done,
 'pointsMet',configured=4 and required_done=4 and elective_done>=6);
end $$;
revoke all on function portal_private.activity_progress(uuid) from public,anon,authenticated;
do $$declare source text;begin
 select pg_get_functiondef('portal_private.archive_snapshot()'::regprocedure) into source;
 source:=replace(source,'''pointsMet'',points>=target','''pointsMet'',(portal_private.activity_progress(new.id)->>''pointsMet'')::boolean');
 source:=replace(source,'new.completion_snapshot:=jsonb_build_object(', 'points:=(portal_private.activity_progress(new.id)->>''approved'')::integer; new.completion_snapshot:=portal_private.activity_progress(new.id)||jsonb_build_object(');
 execute source;
end $$;

alter table public.one_on_ones add column if not exists completion_reported_at timestamptz;
alter table public.one_on_ones add column if not exists completion_reported_by uuid references auth.users(id);
alter table public.one_on_ones add column if not exists completion_reviewed_by uuid references auth.users(id);
alter table public.one_on_ones add column if not exists completion_reviewed_at timestamptz;
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.one_on_ones'::regclass and contype='c' and pg_get_constraintdef(oid) like '%not_scheduled%' loop
  execute format('alter table public.one_on_ones drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.one_on_ones add constraint one_on_ones_completion_status_check check(status in ('not_scheduled','pending','scheduled','completed','reschedule_needed','denied','canceled','completion_pending'));
-- All writes still pass the existing owner/cohort guard and audited endpoints.
do $$declare source text;begin
 select pg_get_functiondef('portal_private.guard_write()'::regprocedure) into source;
 source:=replace(source,'''scheduled'',''pending'',''canceled''','''scheduled'',''pending'',''canceled'',''completion_pending''');
 source:=replace(source,'(to_jsonb(old)->>''status'')::text<>''completed''',
 '((to_jsonb(old)->>''status'')::text<>''completed'' or (to_jsonb(old)->>''completed_date'')::timestamptz < date_trunc(''year'',now())+(case when extract(month from now())<=6 then interval ''0 months'' else interval ''6 months'' end))');
 execute source;
end $$;
create or replace function portal_private.one_on_one_completion(operation text,record_id uuid,payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare person public.members; assignment public.director_assignments; meeting public.one_on_ones; did uuid;
 happened timestamptz; staff boolean; result uuid;begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if record_id is not null then
  select * into meeting from public.one_on_ones where id=record_id for update;
  if meeting.id is null then raise exception 'Meeting not found'; end if;
  select * into person from public.members where id=meeting.member_id;
  did:=meeting.director_id;
 else
  select * into person from public.members where id=(payload->>'member_id')::uuid;
  did:=(payload->>'director_id')::uuid;
 end if;
 if person.id is null or person.program_status<>'active' then raise exception 'Choose an active Trailblazer'; end if;
 select a.* into assignment from public.director_assignments a join public.directors d on d.id=a.director_id
 where a.cohort_id=person.cohort_id and a.director_id=did and a.active and d.active and 'meetings'=any(a.capabilities)
 and (a.start_date is null or a.start_date<=current_date) and (a.end_date is null or a.end_date>=current_date) limit 1;
 if assignment.id is null then raise exception 'Choose a currently assigned director'; end if;
 staff:=portal_private.is_admin() or (portal_private.can_manage(person.cohort_id,'meetings') and exists(select 1 from public.directors where id=did and active and auth_user_id=auth.uid()));
 if operation='request' then
  if not portal_private.owns_member(person.id,true) and not staff then raise exception 'Meeting access required'; end if;
 elsif operation in ('approve','record','reject') then
  if not staff then raise exception 'Only this director or an administrator can approve completion'; end if;
 else raise exception 'Unknown completion operation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(person.id::text||did::text,0));
 if meeting.id is null then select * into meeting from public.one_on_ones where member_id=person.id and director_id=did for update; end if;
 if operation='reject' then
  if meeting.status is distinct from 'completion_pending' then raise exception 'No completion request is awaiting review'; end if;
  update public.one_on_ones set status='reschedule_needed',completion_reviewed_by=auth.uid(),completion_reviewed_at=now(),admin_note=coalesce(payload->>'note',admin_note) where id=meeting.id;
  insert into public.member_notifications(member_id,notification_type,title,body,target_page,dedupe_key)
  values(person.id,'one_on_one','One-on-one completion needs correction',coalesce(nullif(payload->>'note',''),'Contact your director about your completion request.'),'oneOnOnes','completion-rejected:'||meeting.id||':'||now());
  return meeting.id;
 end if;
 happened:=case when operation='approve' then meeting.scheduled_date else (payload->>'completed_at')::timestamptz end;
 if happened is null or happened>now() then raise exception 'Enter when the meeting took place, using a past date and time'; end if;
 if happened < date_trunc('year',now())+(case when extract(month from now())<=6 then interval '0 months' else interval '6 months' end) then raise exception 'Enter a meeting from the current semester'; end if;
 if operation='approve' and meeting.status not in ('completion_pending','scheduled') then raise exception 'Choose a scheduled meeting or a completion request'; end if;
 if meeting.status='completed' and date_trunc('month',meeting.completed_date)>=date_trunc('year',now())+(case when extract(month from now())<=6 then interval '0 months' else interval '6 months' end) then return meeting.id; end if;
 if operation='request' and meeting.id is null then raise exception 'Refresh your assigned one-on-ones and try again'; end if;
 if meeting.id is null then
  insert into public.one_on_ones(member_id,director_id,director_assignment_id,status,scheduled_date,completed_date,meeting_method,location_method,scheduled_by_user_id,
   completion_reported_at,completion_reported_by,completion_reviewed_by,completion_reviewed_at,admin_note)
  values(person.id,did,assignment.id,'completed',happened,happened,'in_person',nullif(payload->>'location',''),auth.uid(),now(),auth.uid(),auth.uid(),now(),nullif(payload->>'note','')) returning id into result;
 else
  update public.one_on_ones set status=case when operation='request' then 'completion_pending' else 'completed' end,scheduled_date=happened,
   completed_date=case when operation='request' then null else happened end,completion_reported_at=case when operation='approve' then completion_reported_at else now() end,
   completion_reported_by=case when operation='approve' then completion_reported_by else auth.uid() end,
   completion_reviewed_by=case when operation='request' then null else auth.uid() end,completion_reviewed_at=case when operation='request' then null else now() end,
   location_method=coalesce(nullif(payload->>'location',''),location_method),admin_note=coalesce(nullif(payload->>'note',''),admin_note) where id=meeting.id returning id into result;
 end if;
 if operation='request' then
  insert into public.director_notifications(director_id,title,body,dedupe_key)
  values(did,'Approve completed one-on-one',person.first_name||' '||person.last_name||' reported a completed one-on-one. Open One-on-ones to approve or request a correction.','completion-request:'||result||':'||now());
 end if;
 return result;
end $$;
create or replace function public.portal_one_on_one_completion(operation text,record_id uuid default null,payload jsonb default '{}') returns uuid
language sql security invoker set search_path='' as $$ select portal_private.one_on_one_completion(operation,record_id,payload); $$;
revoke all on function public.portal_review_activity(uuid,jsonb),portal_private.review_activity(uuid,jsonb),public.portal_record_activity(jsonb),portal_private.record_activity(jsonb),
 public.portal_one_on_one_completion(text,uuid,jsonb),portal_private.one_on_one_completion(text,uuid,jsonb) from public,anon;
grant execute on function public.portal_review_activity(uuid,jsonb),portal_private.review_activity(uuid,jsonb),public.portal_record_activity(jsonb),portal_private.record_activity(jsonb),
 public.portal_one_on_one_completion(text,uuid,jsonb),portal_private.one_on_one_completion(text,uuid,jsonb) to authenticated;

-- Keep deadline, profile, birthday and meeting reminders; remove weekly points emails.
do $$declare source text;begin
 select pg_get_functiondef('portal_private.queue_template(uuid,text,jsonb,text,text)'::regprocedure) into source;
 source:=replace(source,'select coalesce(sum(points_awarded),0) into total from public.point_submissions where member_id=mid and status=''approved'';',
 'total:=(portal_private.activity_progress(mid)->>''approved'')::integer;');
 execute source;
end $$;
do $$declare source text; updated text;begin
 select pg_get_functiondef('portal_private.scheduled_reminders()'::regprocedure) into source;
 updated:=replace(source,'perform portal_private.queue_template(m.id,''low_points'',vars,''low-points:''||stamp,''points'');','null; -- Weekly points reminders removed.');
 updated:=replace(updated,'if total<m.point_requirement then','if not (portal_private.activity_progress(m.id)->>''pointsMet'')::boolean then');
 if updated=source then raise exception 'Could not remove the weekly points reminder'; end if;
 execute updated;
end $$;
notify pgrst,'reload schema';
commit;
