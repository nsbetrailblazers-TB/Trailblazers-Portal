CREATE OR REPLACE FUNCTION portal_private.mutate(kind text, record_id uuid, payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   if desired not in ('approved','denied','needs_review') or desired is null then raise exception 'Invalid decision'; end if;
   if desired='approved' and (coalesce((payload->>'points_awarded')::integer,-1)<0 or (payload->>'points_awarded')::integer>(row_data->>'points_requested')::integer) then raise exception 'Award between zero and the requested points'; end if;
   update public.point_submissions set status=desired,points_awarded=case when desired='approved' then (payload->>'points_awarded')::integer else 0 end,
   director_note=nullif(trim(payload->>'director_note'),''),reviewed_by=did,reviewed_at=now() where id=rid;
   insert into public.member_notifications(member_id,notification_type,title,body,target_page) values(mid,'accountability','Points '||case when desired='denied' then 'rejected' else desired end,payload->>'director_note','points');
 elsif kind='one_on_one' then
   select to_jsonb(o) into row_data from public.one_on_ones o where id=rid for update;
   if row_data is null then raise exception 'Meeting not found'; end if;
   select cohort_id into cid from public.members where id=(row_data->>'member_id')::uuid;
   if not portal_private.can_manage(cid,'meetings') or (not portal_private.is_admin() and (row_data->>'director_id')::uuid is distinct from did) then raise exception 'Meeting access required'; end if;
   if row_data->>'status'='completed' or (row_data->>'status'='canceled' and payload->>'status'<>'scheduled') then raise exception 'This meeting is already closed'; end if;
   desired:=payload->>'status';
   if desired not in ('scheduled','completed','canceled','reschedule_needed') or desired is null then raise exception 'Invalid meeting status'; end if;
   if desired='completed' and (row_data->>'status'<>'scheduled' or (row_data->>'scheduled_date')::timestamptz>now()) then raise exception 'Only a scheduled meeting that has started can be completed'; end if;
   if desired='scheduled' and coalesce((payload->>'scheduled_date')::timestamptz,now())<=now() then raise exception 'Choose a future time'; end if;
   update public.one_on_ones set status=desired,scheduled_date=case when desired='scheduled' then (payload->>'scheduled_date')::timestamptz else scheduled_date end,
   admin_note=coalesce(payload->>'admin_note',admin_note),meeting_method='in_person',location_method=coalesce(payload->>'location_method',location_method),
   completed_date=case when desired='completed' then now() else null end,updated_at=now() where id=rid;
 elsif kind='strike' then
   if rid is null then
     mid:=(payload->>'member_id')::uuid;
     insert into public.strikes(member_id,reason,issued_by,issued_at,staff_note)
     values(mid,nullif(trim(payload->>'reason'),''),did,coalesce((payload->>'issued_at')::timestamptz,now()),payload->>'staff_note') returning id into rid;
   else
     if nullif(trim(payload->>'resolution_note'),'') is null then raise exception 'Provide a correction/removal reason'; end if;
     if coalesce(payload->>'status','removed') not in ('removed','resolved') then raise exception 'Choose resolved or removed'; end if;
     update public.strikes set status=coalesce(payload->>'status','removed'),resolved_at=now(),resolution_note=payload->>'resolution_note' where id=rid and status='active' returning member_id into mid;
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
   if exists(select 1 from jsonb_array_elements_text(payload->'capabilities') v where v not in ('points','strikes','resumes','content','events','meetings','care')) then raise exception 'Unknown capability'; end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION portal_private.save_event(record_id uuid, payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cid uuid; rid uuid:=record_id; start_at timestamptz; end_at timestamptz; begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 cid:=(payload->>'cohort_id')::uuid;
 if not portal_private.can_manage(cid,'events') then raise exception 'Event permission required'; end if;
 if coalesce((payload->>'all_day')::boolean,false) then
   if (payload->>'all_day_start') is null then raise exception 'All-day start date required'; end if;
   start_at:=((payload->>'all_day_start')||'T00:00:00Z')::timestamptz;
   end_at:=((coalesce(payload->>'all_day_end',payload->>'all_day_start'))||'T23:59:59Z')::timestamptz;
 else start_at:=(payload->>'start_time')::timestamptz;end_at:=(payload->>'end_time')::timestamptz;end if;
 if rid is null then
   insert into public.meetings(cohort_id,title,event_category,start_time,end_time,location,description,all_day,all_day_start,all_day_end,created_by_user_id)
   values(cid,nullif(trim(payload->>'title'),''),payload->>'event_category',start_at,end_at,payload->>'location',payload->>'description',coalesce((payload->>'all_day')::boolean,false),(payload->>'all_day_start')::date,(payload->>'all_day_end')::date,auth.uid()) returning id into rid;
 else
   update public.meetings set title=nullif(trim(payload->>'title'),''),event_category=payload->>'event_category',start_time=start_at,end_time=end_at,
   location=payload->>'location',description=payload->>'description',all_day=coalesce((payload->>'all_day')::boolean,false),all_day_start=(payload->>'all_day_start')::date,all_day_end=(payload->>'all_day_end')::date,active=(payload->>'active')::boolean where id=rid;
   if not found then raise exception 'Event not found'; end if;
 end if;
 update public.meetings set location_tbd=coalesce((payload->>'location_tbd')::boolean,false),meeting_type=coalesce(payload->>'meeting_type',meeting_type),dress_code=payload->>'dress_code',what_to_bring=payload->>'what_to_bring' where id=rid;
 return rid;
end $function$
;
CREATE OR REPLACE FUNCTION portal_private.submit_file(kind text, path text, filename text, payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare mid uuid; rid uuid; begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select id into mid from public.members where auth_user_id=auth.uid();
 if not portal_private.owns_member(mid,true) then raise exception 'An active member profile is required'; end if;
 if split_part(path,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='trailblazers-private' and name=path) then raise exception 'Upload your file first'; end if;
 if kind='resume' then
   if path !~* '\.pdf$' or not exists(select 1 from storage.objects where bucket_id='trailblazers-private' and name=path and metadata->>'mimetype'='application/pdf') then raise exception 'Resumes must be PDF files'; end if;
   insert into public.resume_submissions(member_id,file_path,file_name) values(mid,path,filename) returning id into rid;
 elsif kind='points' then
   if not exists(select 1 from storage.objects where bucket_id='trailblazers-private' and name=path and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')) then raise exception 'Point evidence must be a JPG, PNG, or WebP picture'; end if;
   if (payload->>'points_requested')::integer not between 1 and 1000 or nullif(trim(payload->>'activity_name'),'') is null or (payload->>'activity_date')::date>current_date then raise exception 'Check activity, date, and points'; end if;
   insert into public.point_submissions(member_id,activity_name,activity_date,description,points_requested,category,evidence_path,request_id)
   values(mid,nullif(trim(payload->>'activity_name'),''),(payload->>'activity_date')::date,payload->>'description',(payload->>'points_requested')::integer,payload->>'category',path,(payload->>'request_id')::uuid) returning id into rid;
 else raise exception 'Unknown submission'; end if;
 return rid;
end $function$
;
