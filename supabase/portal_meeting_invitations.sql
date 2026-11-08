-- Invitations are separate from the per-director completion checklist.
create table public.one_on_one_invitations (
 id uuid primary key, organizer_id uuid not null references auth.users(id),
 member_ids uuid[] not null check(cardinality(member_ids) between 1 and 2),
 director_id uuid references public.directors(id),
 scheduled_date timestamptz not null, location text not null,
 status text not null default 'pending' check(status in ('pending','scheduled','declined','canceled','completed')),
 participants jsonb not null, responses jsonb not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(director_id is not null or cardinality(member_ids)=2)
);
alter table public.one_on_one_invitations enable row level security;
revoke all on public.one_on_one_invitations from anon,authenticated;
grant select on public.one_on_one_invitations to authenticated;

create function portal_private.invitation_access(ids uuid[],did uuid,organizer uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (portal_private.is_admin() or organizer=auth.uid()
 or exists(select 1 from public.members where id=any(ids) and auth_user_id=auth.uid() and program_status='active')
 or exists(select 1 from public.directors where id=did and auth_user_id=auth.uid() and active));
$$;
revoke all on function portal_private.invitation_access(uuid[],uuid,uuid) from public,anon;
grant execute on function portal_private.invitation_access(uuid[],uuid,uuid) to authenticated;
create policy invitation_read on public.one_on_one_invitations for select to authenticated
 using(portal_private.invitation_access(member_ids,director_id,organizer_id));
create index invitation_members on public.one_on_one_invitations using gin(member_ids);
create index invitation_director on public.one_on_one_invitations(director_id,scheduled_date);

create function portal_private.meeting_directory() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not (portal_private.is_admin()
 or exists(select 1 from public.members where auth_user_id=auth.uid() and program_status='active')
 or exists(select 1 from public.directors where auth_user_id=auth.uid() and active)) then raise exception 'An active portal account is required'; end if;
 return jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(preferred_name,first_name)||' '||last_name,'self',auth_user_id=auth.uid()) order by last_name,first_name),'[]') from public.members where program_status='active' and auth_user_id is not null),
 'directors',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',first_name||' '||last_name,'self',auth_user_id=auth.uid()) order by last_name,first_name),'[]') from public.directors where active and auth_user_id is not null));
end $$;
create function public.portal_meeting_directory() returns jsonb language sql security invoker set search_path='' as $$select portal_private.meeting_directory()$$;

create function portal_private.invitation_notice(r public.one_on_one_invitations,heading text,message text) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.member_notifications(member_id,notification_type,title,body,target_page,dedupe_key)
 select mid,'one_on_one',heading,message,'oneOnOnes','one-on-one-invite:'||r.id||':'||r.updated_at||':'||heading||':'||mid
 from unnest(r.member_ids) mid on conflict(dedupe_key) do nothing;
 if r.director_id is not null then
 insert into public.director_notifications(director_id,title,body,dedupe_key)
 values(r.director_id,heading,message,'one-on-one-invite:'||r.id||':'||r.updated_at||':'||heading) on conflict(dedupe_key) do nothing;
 end if;
end $$;
revoke all on function portal_private.invitation_notice(public.one_on_one_invitations,text,text) from public,anon,authenticated;

create function portal_private.save_invitation(request_id uuid,member_ids uuid[],director_id uuid,scheduled_date timestamptz,location text) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.one_on_one_invitations; mids uuid[]; people jsonb:='[]'; replies jsonb:='{}'; p record; participant boolean:=false;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select array_agg(distinct x) into mids from unnest(member_ids) x;
 if request_id is null or cardinality(mids) not between 1 and 2 or mids is null or array_position(mids,null) is not null
 or (director_id is null and cardinality(mids)<>2) then raise exception 'Choose up to one director and two Trailblazers, with at least two people'; end if;
 if scheduled_date is null or scheduled_date<=now() then raise exception 'Choose a future date and time'; end if;
 if nullif(trim(location),'') is null then raise exception 'Enter the in-person location'; end if;
 perform pg_advisory_xact_lock(hashtext('one_on_one_schedule'));
 select * into r from public.one_on_one_invitations where id=request_id;
 if found then
  if r.organizer_id<>auth.uid() then raise exception 'Request ID already used'; end if;
  return r.id;
 end if;
 if (select count(*) from public.members m where m.id=any(mids) and m.program_status='active' and m.auth_user_id is not null)<>cardinality(mids)
 or (director_id is not null and not exists(select 1 from public.directors d where d.id=director_id and d.active and d.auth_user_id is not null)) then raise exception 'Choose active participants with portal accounts'; end if;
 for p in select 'member:'||m.id as key,coalesce(m.preferred_name,m.first_name)||' '||m.last_name as name,m.auth_user_id as uid from public.members m where m.id=any(mids)
 union all select 'director:'||d.id,d.first_name||' '||d.last_name,d.auth_user_id from public.directors d where d.id=director_id loop
  people:=people||jsonb_build_array(jsonb_build_object('key',p.key,'name',p.name));
  replies:=replies||jsonb_build_object(p.key,case when p.uid=auth.uid() then 'accepted' else 'pending' end);
  participant:=participant or p.uid=auth.uid();
 end loop;
 if not participant and not portal_private.is_admin() then raise exception 'Include yourself in the meeting'; end if;
 if (select count(distinct uid) from (select auth_user_id uid from public.members where id=any(mids) union all select auth_user_id from public.directors d where d.id=director_id) s)<2 then raise exception 'Choose at least two different people'; end if;
 insert into public.one_on_one_invitations(id,organizer_id,member_ids,director_id,scheduled_date,location,participants,responses)
 values(request_id,auth.uid(),mids,director_id,scheduled_date,trim(location),people,replies) returning * into r;
 perform portal_private.invitation_notice(r,'One-on-one invitation',
 'You are invited to an in-person one-on-one on '||to_char(r.scheduled_date at time zone 'America/New_York','Mon FMDD at FMHH12:MI AM')||' Eastern at '||r.location||'. Open One-on-Ones in your portal to accept or decline.');
 return r.id;
end $$;
create function public.portal_create_meeting_invitation(request_id uuid,member_ids uuid[],director_id uuid,scheduled_date timestamptz,location text) returns uuid
language sql security invoker set search_path='' as $$select portal_private.save_invitation(request_id,member_ids,director_id,scheduled_date,location)$$;

create function portal_private.respond_invitation(record_id uuid,decision text) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.one_on_one_invitations; keys text[]; k text; mid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 perform pg_advisory_xact_lock(hashtext('one_on_one_schedule'));
 select * into r from public.one_on_one_invitations where id=record_id for update;
 if not found or not portal_private.invitation_access(r.member_ids,r.director_id,r.organizer_id) then raise exception 'Meeting access required'; end if;
 select array_agg(key) into keys from (
 select 'member:'||m.id key from public.members m where m.id=any(r.member_ids) and m.auth_user_id=auth.uid() and m.program_status='active'
 union all select 'director:'||d.id from public.directors d where d.id=r.director_id and d.auth_user_id=auth.uid() and d.active) s;
 if decision='cancel' then
  if r.organizer_id<>auth.uid() and not portal_private.is_admin() then raise exception 'Only the organizer or an administrator can cancel'; end if;
  if r.status not in ('pending','scheduled') then raise exception 'This meeting is already closed'; end if;
  r.status:='canceled';
 elsif decision='complete' then
  if not portal_private.is_admin() and not exists(select 1 from public.directors where id=r.director_id and auth_user_id=auth.uid() and active) then raise exception 'Director or administrator approval required'; end if;
  if r.status<>'scheduled' or r.scheduled_date>now() then raise exception 'Only an accepted meeting in the past can be completed'; end if;
  -- Each assigned Trailblazer receives director credit through the existing approval rules.
  if r.director_id is not null then
   foreach mid in array r.member_ids loop
    if exists(select 1 from public.members m join public.director_assignments a on a.cohort_id=m.cohort_id where m.id=mid and a.director_id=r.director_id and a.active and 'meetings'=any(a.capabilities) and (a.start_date is null or a.start_date<=current_date) and (a.end_date is null or a.end_date>=current_date)) then
     perform portal_private.one_on_one_completion('record',null,jsonb_build_object('member_id',mid,'director_id',r.director_id,'completed_at',r.scheduled_date,'location',r.location));
    end if;
   end loop;
  end if;
  r.status:='completed';
 elsif decision in ('accept','decline') then
  if keys is null then raise exception 'Only an invited participant can respond'; end if;
  if r.status<>'pending' or r.scheduled_date<=now() then raise exception 'This invitation is closed or its time has passed'; end if;
  foreach k in array keys loop r.responses:=jsonb_set(r.responses,array[k],to_jsonb(case when decision='accept' then 'accepted'::text else 'declined'::text end)); end loop;
  if decision='decline' then r.status:='declined';
  elsif not exists(select 1 from jsonb_each_text(r.responses) where value<>'accepted') then
   if exists(select 1 from public.one_on_one_invitations o where o.id<>r.id and o.status='scheduled' and o.scheduled_date=r.scheduled_date and (o.member_ids&&r.member_ids or o.director_id=r.director_id))
   or exists(select 1 from public.one_on_ones o where o.status='scheduled' and o.scheduled_date=r.scheduled_date and (o.member_id=any(r.member_ids) or o.director_id=r.director_id)) then raise exception 'A participant already has a meeting at this time'; end if;
   r.status:='scheduled';
  end if;
 else raise exception 'Choose accept, decline, cancel, or complete'; end if;
 update public.one_on_one_invitations set responses=r.responses,status=r.status,updated_at=clock_timestamp() where id=r.id returning * into r;
 if r.status<>'pending' then perform portal_private.invitation_notice(r,'One-on-one '||r.status,'Your one-on-one is '||r.status||'. Open One-on-Ones in the portal for details.'); end if;
 return r.id;
end $$;
create function public.portal_respond_meeting_invitation(record_id uuid,decision text) returns uuid language sql security invoker set search_path='' as $$select portal_private.respond_invitation(record_id,decision)$$;

-- Legacy rows remain actionable, including meetings created before invitations existed.
do $$declare source text;begin
 select pg_get_functiondef('portal_private.validate_meeting()'::regprocedure) into source;
 source:=replace(source,'if exists(select 1 from public.one_on_ones o',
 'if exists(select 1 from public.one_on_one_invitations i where i.status=''scheduled'' and i.scheduled_date=new.scheduled_date and (new.member_id=any(i.member_ids) or new.director_id=i.director_id)) then raise exception ''A participant already has an accepted invitation at this time''; end if; if exists(select 1 from public.one_on_ones o');
 execute source;
end $$;
alter table public.one_on_ones add column member_accepted_at timestamptz;
alter table public.one_on_one_history add column completed_date timestamptz;
alter table public.one_on_one_history add column admin_note text;
create or replace function portal_private.meeting_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.status,old.scheduled_date,old.completed_date,old.location_method,old.meeting_method,old.admin_note) is distinct from (new.status,new.scheduled_date,new.completed_date,new.location_method,new.meeting_method,new.admin_note) then
 insert into public.one_on_one_history(one_on_one_id,member_id,director_id,previous_status,scheduled_date,completed_date,location_method,meeting_method,admin_note,changed_by)
 values(old.id,old.member_id,old.director_id,old.status,old.scheduled_date,old.completed_date,old.location_method,old.meeting_method,old.admin_note,auth.uid());
 end if;return new;
end $$;
create function portal_private.edit_past_meeting(record_id uuid,payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.one_on_ones; happened timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into r from public.one_on_ones where id=record_id for update;
 if not found then raise exception 'Meeting not found'; end if;
 if not portal_private.is_admin() and not (exists(select 1 from public.directors where id=r.director_id and auth_user_id=auth.uid() and active) and portal_private.member_access(r.member_id,'meetings')) then raise exception 'Only this director or an administrator can edit'; end if;
 if r.status not in ('completed','scheduled','completion_pending','canceled','reschedule_needed','denied','pending') then raise exception 'Choose an existing meeting'; end if;
 happened:=(payload->>'scheduled_date')::timestamptz;
 if happened is null then raise exception 'Enter the meeting date and time'; end if;
 if r.status='completed' and ((payload->>'completed_date')::timestamptz is null or (payload->>'completed_date')::timestamptz>now() or happened>now()) then raise exception 'Completed meetings require past scheduled and completion dates'; end if;
 update public.one_on_ones set scheduled_date=happened,
 completed_date=case when r.status='completed' then (payload->>'completed_date')::timestamptz else r.completed_date end,
 location_method=nullif(trim(payload->>'location_method'),''),admin_note=nullif(trim(payload->>'admin_note'),'') where id=r.id;
 return r.id;
end $$;
create function public.portal_edit_past_meeting(record_id uuid,payload jsonb) returns uuid language sql security invoker set search_path='' as $$select portal_private.edit_past_meeting(record_id,payload)$$;

create function portal_private.respond_legacy_meeting(record_id uuid,decision text) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.one_on_ones;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into r from public.one_on_ones where id=record_id for update;
 if not found then raise exception 'Meeting not found'; end if;
 if portal_private.owns_member(r.member_id,true) and r.status='scheduled' and decision='accept' then
  if r.scheduled_date<=now() then raise exception 'This meeting time has passed. Contact your director to reschedule'; end if;
  update public.one_on_ones set member_accepted_at=now() where id=r.id;
 else
  perform public.director_respond_one_on_one(record_id,case when decision='decline' then 'deny' else decision end);
 end if;
 return r.id;
end $$;
create function public.portal_respond_legacy_meeting(record_id uuid,decision text) returns uuid language sql security invoker set search_path='' as $$select portal_private.respond_legacy_meeting(record_id,decision)$$;
revoke all on function portal_private.respond_legacy_meeting(uuid,text),public.portal_respond_legacy_meeting(uuid,text) from public,anon;
grant execute on function portal_private.respond_legacy_meeting(uuid,text),public.portal_respond_legacy_meeting(uuid,text) to authenticated;

-- Staff can record historical meetings; semester credit still uses the actual completion date.
do $$declare source text;begin
 select pg_get_functiondef('portal_private.one_on_one_completion(text,uuid,jsonb)'::regprocedure) into source;
 source:=replace(source,'if happened < date_trunc(''year'',now())','if not staff and happened < date_trunc(''year'',now())');
 execute source;
end $$;

revoke all on function portal_private.meeting_directory(),public.portal_meeting_directory(),portal_private.save_invitation(uuid,uuid[],uuid,timestamptz,text),public.portal_create_meeting_invitation(uuid,uuid[],uuid,timestamptz,text),portal_private.respond_invitation(uuid,text),public.portal_respond_meeting_invitation(uuid,text),portal_private.edit_past_meeting(uuid,jsonb),public.portal_edit_past_meeting(uuid,jsonb) from public,anon;
grant execute on function portal_private.meeting_directory(),public.portal_meeting_directory(),portal_private.save_invitation(uuid,uuid[],uuid,timestamptz,text),public.portal_create_meeting_invitation(uuid,uuid[],uuid,timestamptz,text),portal_private.respond_invitation(uuid,text),public.portal_respond_meeting_invitation(uuid,text),portal_private.edit_past_meeting(uuid,jsonb),public.portal_edit_past_meeting(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
