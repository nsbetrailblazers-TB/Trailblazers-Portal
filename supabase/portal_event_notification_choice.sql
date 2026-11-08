begin;
-- A per-save choice, scoped to this RPC's transaction. Older clients still notify.
create or replace function public.portal_save_event(record_id uuid default null,payload jsonb default '{}')
returns uuid language plpgsql security invoker set search_path='' as $$
declare result_id uuid; previous_setting text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if payload ? 'notify_members' and jsonb_typeof(payload->'notify_members')<>'boolean' then
   raise exception 'Choose whether to notify members';
 end if;
 previous_setting:=current_setting('portal.event_notifications',true);
 perform set_config('portal.event_notifications',case when payload->'notify_members'='false'::jsonb then 'off' else 'on' end,true);
 result_id:=portal_private.save_event(record_id,payload-'notify_members');
 perform set_config('portal.event_notifications',coalesce(previous_setting,''),true);
 return result_id;
 -- Failed calls roll back their transaction-local setting with the save.
end $$;
revoke all on function public.portal_save_event(uuid,jsonb) from public,anon;
grant execute on function public.portal_save_event(uuid,jsonb) to authenticated;

-- Preserve existing resource opt-outs and cohort/audience selection.
create or replace function public.enqueue_cohort_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
declare typ text; body_text text; page text; begin
 if tg_table_name='meetings' and current_setting('portal.event_notifications',true)='off' then return new; end if;
 if tg_table_name='announcements' then
   if not new.active or new.audience='directors' or new.publish_at>now() or new.expires_at<=now() then return new; end if;
   typ:='announcement'; body_text:=new.body; page:='nsbe';
 elsif tg_table_name='resources' then
   if current_setting('portal.resource_notifications',true)='off' then return new; end if;
   if not new.active then return new; end if;
   typ:='resource'; body_text:=new.description; page:='resources';
 else typ:='event'; body_text:=case when new.active then new.description else 'This event has been canceled.' end; page:='calendar';
 end if;
 insert into public.member_notifications(member_id,notification_type,title,body,target_page)
 select id,typ,new.title,body_text,page from public.members where program_status='active' and (new.cohort_id is null or cohort_id=new.cohort_id);
 return new;
end $$;
notify pgrst,'reload schema';
commit;
