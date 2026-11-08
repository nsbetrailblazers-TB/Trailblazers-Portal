-- Portal management upgrade. Applied remotely with the Supabase migration tool.
-- No account is automatically promoted to administrator.
create schema if not exists portal_private;
revoke all on schema portal_private from public, anon;
grant usage on schema portal_private to authenticated;

create table public.portal_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.portal_admins enable row level security;
alter table public.director_assignments add column capabilities text[] not null
  default array['points','strikes','resumes','content','events','meetings'];
alter table public.cohorts add column point_requirement integer not null default 30 check (point_requirement > 0);
alter table public.point_submissions add column category text;
alter table public.point_submissions add column evidence_path text;
alter table public.point_submissions add column request_id uuid unique;
alter table public.strikes add column staff_note text;
alter table public.announcements add column pinned boolean not null default false;
alter table public.announcements add column audience text not null default 'members' check (audience in ('members','directors'));
alter table public.one_on_ones drop constraint one_on_ones_status_check;
alter table public.one_on_ones add constraint one_on_ones_status_check
  check (status in ('not_scheduled','scheduled','completed','reschedule_needed','canceled'));
create unique index members_email_normalized on public.members(lower(uf_email)) where uf_email is not null;
create unique index directors_email_normalized on public.directors(lower(email));

create table public.resume_submissions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  file_path text not null unique,
  file_name text not null,
  status text not null default 'submitted' check (status in ('submitted','under_review','reviewed')),
  feedback text,
  reviewed_by uuid references auth.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.resume_submissions enable row level security;
create index resume_member_idx on public.resume_submissions(member_id);
create index members_cohort_idx on public.members(cohort_id);

create function portal_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.portal_admins where user_id=auth.uid() and active);
$$;
create function portal_private.can_manage(cid uuid, capability text default null) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (portal_private.is_admin() or exists(
 select 1 from public.directors d join public.director_assignments a on a.director_id=d.id
 join public.cohorts c on c.id=a.cohort_id
 where d.auth_user_id=auth.uid() and d.active and a.active and c.status='active' and c.id=cid
 and (a.start_date is null or a.start_date<=current_date) and (a.end_date is null or a.end_date>=current_date)
 and (capability is null or capability=any(a.capabilities))));
$$;
create function portal_private.owns_member(mid uuid, require_active boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.members m join public.cohorts c on c.id=m.cohort_id
 where m.id=mid and m.auth_user_id=auth.uid() and m.program_status<>'inactive'
 and (not require_active or (m.program_status='active' and c.status='active')));
$$;
create function portal_private.member_access(mid uuid, capability text default null) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.members m where m.id=mid
 and (portal_private.owns_member(mid) or portal_private.can_manage(m.cohort_id,capability)));
$$;
create function portal_private.member_cohort(cid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.members m where m.auth_user_id=auth.uid()
 and m.program_status<>'inactive' and (cid is null or m.cohort_id=cid));
$$;

-- Replace the previous organization-wide director policies.
do $$ declare r record; begin
 for r in select tablename,policyname from pg_policies where schemaname='public' and tablename in
 ('members','cohorts','directors','director_assignments','point_submissions','strikes','one_on_ones','announcements','resources','meetings','activity_log','portal_settings','email_templates','point_rules') loop
 execute format('drop policy %I on public.%I',r.policyname,r.tablename);
 end loop;
end $$;
create policy portal_admin_read on public.portal_admins for select to authenticated using (user_id=auth.uid() or portal_private.is_admin());
create policy member_read on public.members for select to authenticated using (portal_private.member_access(id));
create policy cohort_read on public.cohorts for select to authenticated using (portal_private.member_cohort(id) or portal_private.can_manage(id));
create policy director_read on public.directors for select to authenticated using (active or auth_user_id=auth.uid() or portal_private.is_admin());
create policy assignment_read on public.director_assignments for select to authenticated using
 (portal_private.can_manage(cohort_id) or (active and portal_private.member_cohort(cohort_id)) or director_id in (select id from public.directors where auth_user_id=auth.uid()));
create policy points_read on public.point_submissions for select to authenticated using (portal_private.member_access(member_id));
create policy strikes_read on public.strikes for select to authenticated using (portal_private.member_access(member_id));
create policy one_on_ones_read on public.one_on_ones for select to authenticated using (portal_private.member_access(member_id));
create policy resumes_read on public.resume_submissions for select to authenticated using (portal_private.member_access(member_id,'resumes'));
create policy announcements_read on public.announcements for select to authenticated using
 (portal_private.can_manage(cohort_id) or (audience='members' and active and publish_at<=now() and (expires_at is null or expires_at>now()) and portal_private.member_cohort(cohort_id))
 or (cohort_id is null and audience='directors' and active and publish_at<=now() and (expires_at is null or expires_at>now()) and public.is_current_director()));
create policy resources_read on public.resources for select to authenticated using
 (portal_private.can_manage(cohort_id) or (active and portal_private.member_cohort(cohort_id)));
create policy events_read on public.meetings for select to authenticated using
 (portal_private.can_manage(cohort_id) or (active and portal_private.member_cohort(cohort_id)));
create policy audit_read on public.activity_log for select to authenticated using (portal_private.is_admin());
create policy settings_read on public.portal_settings for select to authenticated using (portal_private.is_admin());
create policy templates_read on public.email_templates for select to authenticated using (portal_private.is_admin());
create policy rules_read on public.point_rules for select to authenticated using (active or portal_private.is_admin());
revoke insert,update,delete on public.members,public.cohorts,public.directors,public.director_assignments,
 public.point_submissions,public.strikes,public.one_on_ones,public.announcements,public.resources,public.meetings,
 public.activity_log,public.portal_settings,public.email_templates,public.point_rules,public.portal_admins,public.resume_submissions from anon,authenticated;
grant select on public.portal_admins,public.resume_submissions to authenticated;

-- Guard legacy SECURITY DEFINER entry points as well as the new workflows.
create function portal_private.guard_write() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; cap text; mid uuid; begin
 if auth.uid() is null then
   if current_setting('role',true) in ('anon','authenticated') then raise exception 'Sign in required'; end if;
   return new;
 end if;
 if portal_private.is_admin() then return new; end if;
 if tg_table_name in ('cohorts','directors','director_assignments','portal_admins','portal_settings','email_templates','point_rules') then
   raise exception 'Administrator access required';
 elsif tg_table_name='members' then
   if tg_op='UPDATE' and old.auth_user_id=auth.uid() and old.program_status<>'inactive'
    and new.auth_user_id is not distinct from old.auth_user_id and new.cohort_id is not distinct from old.cohort_id
    and new.program_status=old.program_status and new.member_id is not distinct from old.member_id
    and new.archived_at is not distinct from old.archived_at then return new; end if;
   raise exception 'Administrator access required';
 elsif tg_table_name in ('announcements','resources','meetings') then
   cid:=new.cohort_id; cap:=case when tg_table_name='meetings' then 'events' else 'content' end;
   if tg_op='UPDATE' and new.cohort_id is distinct from old.cohort_id then raise exception 'Cannot change audience cohort'; end if;
 else
   mid:=new.member_id;
   if tg_op='UPDATE' and mid<>old.member_id then raise exception 'Cannot change record owner'; end if;
   select cohort_id into cid from public.members where id=mid;
   cap:=case tg_table_name when 'strikes' then 'strikes' when 'point_submissions' then 'points' when 'resume_submissions' then 'resumes' else 'meetings' end;
   if portal_private.owns_member(mid,true) then
     if tg_table_name='point_submissions' and tg_op='INSERT' and new.status='pending' and new.points_awarded is null and new.reviewed_by is null then return new; end if;
     if tg_table_name='resume_submissions' and tg_op='INSERT' and new.status='submitted' and new.reviewed_by is null then return new; end if;
     if tg_table_name='one_on_ones' and tg_op='UPDATE' and old.status not in ('completed','canceled') and new.status='scheduled'
       and new.director_id=old.director_id and exists(select 1 from public.director_assignments a join public.directors d on d.id=a.director_id
       where a.director_id=new.director_id and a.cohort_id=cid and a.active and d.active and 'meetings'=any(a.capabilities)
       and (a.end_date is null or a.end_date>=current_date) and (a.start_date is null or a.start_date<=current_date)) then return new; end if;
   end if;
   if tg_table_name='one_on_ones' and not exists(select 1 from public.directors where id=new.director_id and auth_user_id=auth.uid() and active) then
     raise exception 'Directors may manage only their own one-on-ones';
   end if;
 end if;
 if not portal_private.can_manage(cid,cap) then raise exception 'You do not have permission for this cohort and action'; end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['members','cohorts','directors','director_assignments','point_submissions','strikes','one_on_ones','resume_submissions','announcements','resources','meetings','portal_admins','portal_settings','email_templates','point_rules'] loop
 execute format('create trigger portal_guard before insert or update on public.%I for each row execute function portal_private.guard_write()',t);
 end loop;
end $$;

create function portal_private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.activity_log(actor_user_id,actor_type,action,entity_type,entity_id,details)
 values(auth.uid(),case when exists(select 1 from public.directors where auth_user_id=auth.uid()) then 'director' when auth.uid() is null then 'system' else 'member' end,
 lower(tg_op),tg_table_name,coalesce((to_jsonb(new)->>'id')::uuid,(to_jsonb(new)->>'user_id')::uuid),
 jsonb_build_object('before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new)));
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['members','cohorts','directors','director_assignments','point_submissions','strikes','one_on_ones','resume_submissions','announcements','resources','meetings','portal_admins','portal_settings'] loop
 execute format('create trigger portal_audit after insert or update on public.%I for each row execute function portal_private.audit_change()',t);
 end loop;
end $$;

create function portal_private.access_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('is_admin',portal_private.is_admin(),'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'cohort_id',a.cohort_id,'name',c.name,'capabilities',a.capabilities))
 from public.director_assignments a join public.directors d on d.id=a.director_id join public.cohorts c on c.id=a.cohort_id
 where auth.uid() is not null and d.auth_user_id=auth.uid() and d.active and a.active and c.status='active'
 and (a.end_date is null or a.end_date>=current_date) and (a.start_date is null or a.start_date<=current_date)),'[]'::jsonb));
$$;
create function public.portal_access() returns jsonb language sql security invoker set search_path='' as $$ select portal_private.access_context(); $$;

-- All decisions are locked in the database, preventing two-tab duplicate reviews.
create function portal_private.mutate(kind text, record_id uuid, payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare mid uuid; cid uuid; rid uuid:=record_id; did uuid; row_data jsonb; desired text; entry jsonb; target_user uuid; aid uuid; before_time timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select id into did from public.directors where auth_user_id=auth.uid() and active;
 if kind in ('cohort','member','director','assignment','admin','settings','import') and not portal_private.is_admin() then raise exception 'Administrator access required'; end if;
 if kind='points_review' then
   select to_jsonb(p) into row_data from public.point_submissions p where id=rid for update;
   if row_data is null then raise exception 'Submission not found'; end if;
   mid:=(row_data->>'member_id')::uuid;
   select cohort_id into cid from public.members where id=mid;
   if not portal_private.can_manage(cid,'points') then raise exception 'Point review access required'; end if;
   if row_data->>'status' not in ('pending','needs_review') then raise exception 'Already reviewed. Refresh the queue.'; end if;
   desired:=payload->>'status';
   if desired not in ('approved','denied') or desired is null then raise exception 'Invalid decision'; end if;
   if desired='approved' and (coalesce((payload->>'points_awarded')::integer,-1)<0 or (payload->>'points_awarded')::integer>(row_data->>'points_requested')::integer) then raise exception 'Award between zero and the requested points'; end if;
   update public.point_submissions set status=desired,points_awarded=case when desired='approved' then (payload->>'points_awarded')::integer else 0 end,
   director_note=nullif(trim(payload->>'director_note'),''),reviewed_by=did,reviewed_at=now() where id=rid;
   insert into public.member_notifications(member_id,notification_type,title,body,target_page) values(mid,'accountability','Points '||case when desired='denied' then 'rejected' else desired end,payload->>'director_note','points');
 elsif kind='one_on_one' then
   select to_jsonb(o) into row_data from public.one_on_ones o where id=rid for update;
   if row_data is null then raise exception 'Meeting not found'; end if;
   select cohort_id into cid from public.members where id=(row_data->>'member_id')::uuid;
   if not portal_private.can_manage(cid,'meetings') or (not portal_private.is_admin() and (row_data->>'director_id')::uuid is distinct from did) then raise exception 'Meeting access required'; end if;
   if row_data->>'status' in ('completed','canceled') then raise exception 'This meeting is already closed'; end if;
   desired:=payload->>'status';
   if desired not in ('scheduled','completed','canceled') or desired is null then raise exception 'Invalid meeting status'; end if;
   if desired='completed' and (row_data->>'status'<>'scheduled' or (row_data->>'scheduled_date')::timestamptz>now()) then raise exception 'Only a scheduled meeting that has started can be completed'; end if;
   if desired='scheduled' and coalesce((payload->>'scheduled_date')::timestamptz,now())<=now() then raise exception 'Choose a future time'; end if;
   update public.one_on_ones set status=desired,scheduled_date=case when desired='scheduled' then (payload->>'scheduled_date')::timestamptz else scheduled_date end,
   meeting_method=coalesce(payload->>'meeting_method',meeting_method),location_method=coalesce(payload->>'location_method',location_method),
   completed_date=case when desired='completed' then now() else null end,updated_at=now() where id=rid;
 elsif kind='strike' then
   if rid is null then
     mid:=(payload->>'member_id')::uuid;
     insert into public.strikes(member_id,reason,issued_by,issued_at,staff_note)
     values(mid,nullif(trim(payload->>'reason'),''),did,coalesce((payload->>'issued_at')::timestamptz,now()),payload->>'staff_note') returning id into rid;
   else
     if nullif(trim(payload->>'resolution_note'),'') is null then raise exception 'Provide a correction/removal reason'; end if;
     update public.strikes set status='removed',resolved_at=now(),resolution_note=payload->>'resolution_note' where id=rid and status='active' returning member_id into mid;
     if not found then raise exception 'Strike is already closed or missing'; end if;
   end if;
   insert into public.member_notifications(member_id,notification_type,title,body,target_page) values(mid,'accountability','Strike record updated','Review your accountability record in the portal.','home');
 elsif kind='resume_review' then
   select to_jsonb(r) into row_data from public.resume_submissions r where id=rid for update;
   if row_data is null or row_data->>'status'='reviewed' then raise exception 'Resume is missing or already reviewed'; end if;
   desired:=payload->>'status';
   if desired not in ('under_review','reviewed') or desired is null then raise exception 'Invalid review status'; end if;
   if desired='reviewed' and nullif(trim(payload->>'feedback'),'') is null then raise exception 'Feedback is required'; end if;
   update public.resume_submissions set status=desired,feedback=payload->>'feedback',reviewed_by=auth.uid(),reviewed_at=case when desired='reviewed' then now() else null end,updated_at=now() where id=rid;
   if desired='reviewed' then insert into public.member_notifications(member_id,notification_type,title,body,target_page) values((row_data->>'member_id')::uuid,'system','Resume reviewed','Your resume feedback is ready.','resources'); end if;
 elsif kind in ('announcement','resource') then
   cid:=(payload->>'cohort_id')::uuid;
   if not portal_private.can_manage(cid,'content') then raise exception 'Content access required'; end if;
   if nullif(trim(payload->>'title'),'') is null then raise exception 'Title is required'; end if;
   if kind='announcement' then
     if nullif(trim(payload->>'body'),'') is null then raise exception 'Message is required'; end if;
     if (payload->>'expires_at')::timestamptz<=coalesce((payload->>'publish_at')::timestamptz,now()) then raise exception 'Expiration must follow publication'; end if;
     if rid is null then insert into public.announcements(title,body,cohort_id,created_by,publish_at,expires_at,audience,pinned,active)
     values(payload->>'title',payload->>'body',cid,did,coalesce((payload->>'publish_at')::timestamptz,now()),(payload->>'expires_at')::timestamptz,coalesce(payload->>'audience','members'),coalesce((payload->>'pinned')::boolean,false),coalesce((payload->>'active')::boolean,true)) returning id into rid;
     return rid; end if;
     update public.announcements set title=payload->>'title',body=payload->>'body',publish_at=coalesce((payload->>'publish_at')::timestamptz,publish_at),expires_at=(payload->>'expires_at')::timestamptz,
     audience=coalesce(payload->>'audience','members'),pinned=coalesce((payload->>'pinned')::boolean,false),active=coalesce((payload->>'active')::boolean,true),updated_at=now() where id=rid;
   else
     if coalesce(payload->>'external_url','') !~ '^https?://' then raise exception 'Use an HTTP or HTTPS resource link'; end if;
     if rid is null then insert into public.resources(title,cohort_id,created_by,description,category,external_url,featured,display_order,active)
     values(payload->>'title',cid,did,payload->>'description',payload->>'category',payload->>'external_url',coalesce((payload->>'featured')::boolean,false),coalesce((payload->>'display_order')::integer,0),coalesce((payload->>'active')::boolean,true)) returning id into rid;
     return rid; end if;
     update public.resources set title=payload->>'title',description=payload->>'description',category=payload->>'category',external_url=payload->>'external_url',featured=coalesce((payload->>'featured')::boolean,false),display_order=coalesce((payload->>'display_order')::integer,0),active=coalesce((payload->>'active')::boolean,true),updated_at=now() where id=rid;
   end if;
 elsif kind='cohort' then
   if rid is null then insert into public.cohorts(name,class_number,start_date,end_date,point_requirement) values(nullif(trim(payload->>'name'),''),(payload->>'class_number')::integer,(payload->>'start_date')::date,(payload->>'end_date')::date,coalesce((payload->>'point_requirement')::integer,30)) returning id into rid;
   else
     update public.cohorts set name=payload->>'name',status=payload->>'status',point_requirement=(payload->>'point_requirement')::integer,
     archived_at=case when payload->>'status'='archived' then coalesce(archived_at,now()) else null end where id=rid;
     if payload->>'status'='archived' then
       update public.members set program_status='archived',archived_at=now() where cohort_id=rid and program_status='active';
       update public.director_assignments set active=false,end_date=coalesce(end_date,current_date) where cohort_id=rid and active;
     end if;
   end if;
 elsif kind='member' then
   cid:=(payload->>'cohort_id')::uuid;
   if not exists(select 1 from public.cohorts where id=cid and status='active') and (rid is null or payload->>'program_status'='active') then raise exception 'Choose an active cohort'; end if;
   if coalesce(payload->>'uf_email','') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Valid email required'; end if;
   if rid is null then
     insert into public.members(first_name,last_name,preferred_name,uf_email,cohort_id,member_id)
     values(nullif(trim(payload->>'first_name'),''),nullif(trim(payload->>'last_name'),''),payload->>'preferred_name',lower(trim(payload->>'uf_email')),cid,nullif(trim(payload->>'member_id'),'')) returning id into rid;
   else
     update public.members set first_name=nullif(trim(payload->>'first_name'),''),last_name=nullif(trim(payload->>'last_name'),''),preferred_name=payload->>'preferred_name',
     uf_email=lower(trim(payload->>'uf_email')),member_id=nullif(trim(payload->>'member_id'),''),program_status=payload->>'program_status' where id=rid;
     -- A cohort is historical ownership; changing it would reassign all old records.
     if exists(select 1 from public.members where id=rid and cohort_id is distinct from cid) then raise exception 'Cohort transfers require a reviewed history migration'; end if;
   end if;
 elsif kind='import' then
   if jsonb_typeof(payload->'rows')<>'array' or jsonb_array_length(payload->'rows') not between 1 and 500 then raise exception 'Import 1 to 500 rows'; end if;
   for entry in select value from jsonb_array_elements(payload->'rows') loop
     perform portal_private.mutate('member',null,entry);
   end loop;
   rid:=null;
 elsif kind='director' then
   if coalesce(payload->>'email','') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Valid email required'; end if;
   if rid is null then insert into public.directors(first_name,last_name,email,title,role) values(nullif(trim(payload->>'first_name'),''),nullif(trim(payload->>'last_name'),''),lower(trim(payload->>'email')),payload->>'title',payload->>'role') returning id into rid;
   else update public.directors set first_name=nullif(trim(payload->>'first_name'),''),last_name=nullif(trim(payload->>'last_name'),''),email=lower(trim(payload->>'email')),title=payload->>'title',role=payload->>'role',active=(payload->>'active')::boolean where id=rid; end if;
 elsif kind='assignment' then
   if exists(select 1 from jsonb_array_elements_text(payload->'capabilities') v where v not in ('points','strikes','resumes','content','events','meetings')) then raise exception 'Unknown capability'; end if;
   if rid is null then insert into public.director_assignments(director_id,cohort_id,title,start_date,end_date,capabilities)
     values((payload->>'director_id')::uuid,(payload->>'cohort_id')::uuid,nullif(trim(payload->>'title'),''),(payload->>'start_date')::date,(payload->>'end_date')::date,array(select jsonb_array_elements_text(payload->'capabilities'))) returning id into rid;
   else update public.director_assignments set title=payload->>'title',active=(payload->>'active')::boolean,start_date=(payload->>'start_date')::date,end_date=(payload->>'end_date')::date,capabilities=array(select jsonb_array_elements_text(payload->'capabilities')) where id=rid; end if;
 elsif kind='admin' then
   -- Serialize grants/revocations so concurrent changes cannot remove the final admin.
   perform pg_advisory_xact_lock(hashtext('portal_admin_membership'));
   select id into target_user from auth.users where lower(email)=lower(trim(payload->>'email')) and email_confirmed_at is not null;
   if target_user is null then raise exception 'An existing verified account is required'; end if;
   if not (payload->>'active')::boolean and (select count(*) from public.portal_admins where active and user_id<>target_user)=0 then raise exception 'Keep at least one active administrator'; end if;
   insert into public.portal_admins(user_id,active) values(target_user,(payload->>'active')::boolean) on conflict(user_id) do update set active=excluded.active;
   rid:=target_user;
 elsif kind='settings' then
   insert into public.portal_settings(setting_key,setting_value,description) values(nullif(trim(payload->>'setting_key'),''),payload->'setting_value',payload->>'description')
   on conflict(setting_key) do update set setting_value=excluded.setting_value,description=excluded.description,updated_at=now() returning id into rid;
 else raise exception 'Unknown operation';
 end if;
 return rid;
end $$;
create function public.portal_mutate(kind text, record_id uuid default null, payload jsonb default '{}') returns uuid
language sql security invoker set search_path='' as $$ select portal_private.mutate(kind,record_id,payload); $$;

create function portal_private.submit_file(kind text, path text, filename text, payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare mid uuid; rid uuid; begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select id into mid from public.members where auth_user_id=auth.uid();
 if not portal_private.owns_member(mid,true) then raise exception 'An active member profile is required'; end if;
 if split_part(path,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='trailblazers-private' and name=path) then raise exception 'Upload your file first'; end if;
 if kind='resume' then
   if path !~* '\.pdf$' then raise exception 'Resumes must be PDF files'; end if;
   insert into public.resume_submissions(member_id,file_path,file_name) values(mid,path,filename) returning id into rid;
 elsif kind='points' then
   if (payload->>'points_requested')::integer not between 1 and 1000 or nullif(trim(payload->>'activity_name'),'') is null or (payload->>'activity_date')::date>current_date then raise exception 'Check activity, date, and points'; end if;
   insert into public.point_submissions(member_id,activity_name,activity_date,description,points_requested,category,evidence_path,request_id)
   values(mid,nullif(trim(payload->>'activity_name'),''),(payload->>'activity_date')::date,payload->>'description',(payload->>'points_requested')::integer,payload->>'category',path,(payload->>'request_id')::uuid) returning id into rid;
 else raise exception 'Unknown submission'; end if;
 return rid;
end $$;
create function public.portal_submit_file(kind text,path text,filename text,payload jsonb default '{}') returns uuid
language sql security invoker set search_path='' as $$ select portal_private.submit_file(kind,path,filename,payload); $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('trailblazers-private','trailblazers-private',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy private_upload on storage.objects for insert to authenticated with check
 (bucket_id='trailblazers-private' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.members where auth_user_id=auth.uid() and portal_private.owns_member(id,true)));
create policy private_download on storage.objects for select to authenticated using
 (bucket_id='trailblazers-private' and (
 ((storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.members where auth_user_id=auth.uid() and program_status<>'inactive'))
 or exists(select 1 from public.resume_submissions r where r.file_path=name and portal_private.member_access(r.member_id,'resumes'))
 or exists(select 1 from public.point_submissions p where p.evidence_path=name and portal_private.member_access(p.member_id,'points'))));
create policy private_cleanup on storage.objects for delete to authenticated using
 (bucket_id='trailblazers-private' and (storage.foldername(name))[1]=auth.uid()::text
 and not exists(select 1 from public.resume_submissions where file_path=name)
 and not exists(select 1 from public.point_submissions where evidence_path=name));

revoke all on all functions in schema portal_private from public,anon;
grant execute on function portal_private.is_admin(),portal_private.can_manage(uuid,text),portal_private.owns_member(uuid,boolean),portal_private.member_access(uuid,text),portal_private.member_cohort(uuid),portal_private.access_context(),portal_private.mutate(text,uuid,jsonb),portal_private.submit_file(text,text,text,jsonb) to authenticated;
revoke all on function public.portal_access(),public.portal_mutate(text,uuid,jsonb),public.portal_submit_file(text,text,text,jsonb) from public,anon;
grant execute on function public.portal_access(),public.portal_mutate(text,uuid,jsonb),public.portal_submit_file(text,text,text,jsonb) to authenticated;
-- Reuse the existing member/director requirement row instead of violating its unique key.
create or replace function public.director_schedule_one_on_one(p_member_id uuid,p_scheduled_date timestamptz,p_meeting_method text,p_location_method text default null)
returns public.one_on_ones language plpgsql security definer set search_path='' as $$
declare a public.director_assignments; result public.one_on_ones; begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select da.* into a from public.director_assignments da join public.directors d on d.id=da.director_id join public.members m on m.cohort_id=da.cohort_id
 where m.id=p_member_id and m.program_status='active' and d.auth_user_id=auth.uid() and d.active and da.active and portal_private.can_manage(da.cohort_id,'meetings') limit 1;
 if a.id is null then raise exception 'No authorized active assignment for this member'; end if;
 if p_scheduled_date is null or p_scheduled_date<=now() or p_meeting_method is null then raise exception 'Choose a future time and meeting method'; end if;
 perform pg_advisory_xact_lock(hashtext(p_member_id::text||a.director_id::text));
 select * into result from public.one_on_ones where member_id=p_member_id and director_id=a.director_id for update;
 if result.id is not null then
   if result.status in ('scheduled','completed','canceled') then raise exception 'A meeting already exists. Open it to reschedule or view its history.'; end if;
   perform public.schedule_one_on_one_as_director(result.id,p_scheduled_date,p_meeting_method,p_location_method);
   select * into result from public.one_on_ones where id=result.id;
 else
   insert into public.one_on_ones(member_id,director_id,director_assignment_id,status,scheduled_date,meeting_method,location_method,scheduled_by_user_id)
   values(p_member_id,a.director_id,a.id,'scheduled',p_scheduled_date,p_meeting_method,p_location_method,auth.uid()) returning * into result;
 end if;
 return result;
end $$;

-- Notifications never reveal director-only or not-yet-published content.
create or replace function public.enqueue_cohort_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare typ text; body_text text; page text; begin
 if tg_table_name='announcements' then
   if not new.active or new.audience='directors' or new.publish_at>now() or new.expires_at<=now() then return new; end if;
   typ:='announcement'; body_text:=new.body; page:='nsbe';
 elsif tg_table_name='resources' then
   if not new.active then return new; end if;
   typ:='resource'; body_text:=new.description; page:='resources';
 else typ:='event'; body_text:=case when new.active then new.description else 'This event has been canceled.' end; page:='calendar';
 end if;
 insert into public.member_notifications(member_id,notification_type,title,body,target_page)
 select id,typ,new.title,body_text,page from public.members where program_status='active' and (new.cohort_id is null or cohort_id=new.cohort_id);
 return new;
end $$;

create function portal_private.validate_meeting() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='meetings' then
   if new.end_time is not null and new.end_time<=new.start_time then raise exception 'End time must follow start time'; end if;
 elsif new.status='scheduled' then
   if new.scheduled_date is null then raise exception 'Scheduled meetings require a date'; end if;
   perform pg_advisory_xact_lock(hashtext('one_on_one_schedule'));
   if exists(select 1 from public.one_on_ones o where o.id<>new.id and o.status='scheduled' and o.scheduled_date=new.scheduled_date and (o.member_id=new.member_id or o.director_id=new.director_id)) then raise exception 'Member or director already has a meeting at this time'; end if;
 end if;
 return new;
end $$;
create trigger portal_validate before insert or update on public.one_on_ones for each row execute function portal_private.validate_meeting();
create trigger portal_validate before insert or update on public.meetings for each row execute function portal_private.validate_meeting();
revoke all on function portal_private.validate_meeting() from public,anon,authenticated;
notify pgrst,'reload schema';

