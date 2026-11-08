alter view public.alumni_directory set (security_invoker=true);
alter table public.meetings add column all_day_start date;
alter table public.meetings add column all_day_end date;
-- Calendar dates are kept separately from instants so all-day events don't
-- move to a different day when a member travels to another time zone.
update public.meetings set all_day_start=(start_time at time zone 'America/New_York')::date,
 all_day_end=coalesce((end_time at time zone 'America/New_York')::date,(start_time at time zone 'America/New_York')::date)
 where all_day;
create function portal_private.event_dates() returns trigger language plpgsql set search_path='' as $$
begin
 if new.all_day then
   if tg_op='UPDATE' and new.start_time is distinct from old.start_time and new.all_day_start is not distinct from old.all_day_start then new.all_day_start:=null; end if;
   if tg_op='UPDATE' and new.end_time is distinct from old.end_time and new.all_day_end is not distinct from old.all_day_end then new.all_day_end:=null; end if;
   new.all_day_start:=coalesce(new.all_day_start,(new.start_time at time zone 'America/New_York')::date);
   new.all_day_end:=coalesce(new.all_day_end,(new.end_time at time zone 'America/New_York')::date,new.all_day_start);
   if new.all_day_end<new.all_day_start then raise exception 'End date must not precede start date'; end if;
 else new.all_day_start:=null;new.all_day_end:=null; end if;
 return new;
end $$;
create trigger portal_event_dates before insert or update on public.meetings for each row execute function portal_private.event_dates();
revoke all on function portal_private.event_dates() from public,anon,authenticated;

create function portal_private.save_event(record_id uuid,payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
 return rid;
end $$;
create function public.portal_save_event(record_id uuid default null,payload jsonb default '{}') returns uuid language sql security invoker set search_path='' as $$ select portal_private.save_event(record_id,payload); $$;
revoke all on function portal_private.save_event(uuid,jsonb),public.portal_save_event(uuid,jsonb) from public,anon;
grant execute on function portal_private.save_event(uuid,jsonb),public.portal_save_event(uuid,jsonb) to authenticated;

create policy global_director_events on public.meetings for select to authenticated using (cohort_id is null and active and jsonb_array_length(portal_private.access_context()->'assignments')>0);
create policy global_director_resources on public.resources for select to authenticated using (cohort_id is null and active and jsonb_array_length(portal_private.access_context()->'assignments')>0);
create policy global_director_announcements on public.announcements for select to authenticated using (cohort_id is null and active and publish_at<=now() and (expires_at is null or expires_at>now()) and jsonb_array_length(portal_private.access_context()->'assignments')>0);

notify pgrst,'reload schema';
