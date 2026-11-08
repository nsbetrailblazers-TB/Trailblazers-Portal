-- Run as database owner. Synthetic events, notifications, email jobs and identities roll back.
begin;
select set_config('request.jwt.claim.sub','',true);
do $$
declare au uuid:=gen_random_uuid(); mu uuid:=gen_random_uuid(); cid uuid; mid uuid;
 event_id uuid; payload jsonb; denied boolean;
begin
 insert into auth.users(id,email,email_confirmed_at) values
 (au,'event-choice-admin@example.invalid',now()),(mu,'event-choice-member@example.invalid',now());
 insert into public.portal_admins(user_id,active) values(au,true);
 insert into public.cohorts(name,class_number,status,point_requirement)
 values('__event_notification_test',99146,'active',10) returning id into cid;
 insert into public.members(first_name,last_name,uf_email,cohort_id,program_status,auth_user_id)
 values('Event','Test','event-choice-member@example.invalid',cid,'active',mu) returning id into mid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
 payload:=jsonb_build_object('cohort_id',cid,'title','__silent_event','event_category','tb_event',
 'start_time',now()+interval '2 days','end_time',now()+interval '2 days 1 hour','active',true,'notify_members',false);
 perform set_config('role','authenticated',true);
 event_id:=public.portal_save_event(null,payload);
 if not exists(select 1 from public.meetings where id=event_id) then raise exception 'Silent event was not saved'; end if;
 perform set_config('role','postgres',true);
 if exists(select 1 from public.member_notifications where member_id=mid and title='__silent_event') then raise exception 'Silent create notified members'; end if;
 if current_setting('portal.event_notifications',true)='off' then raise exception 'Silent setting leaked'; end if;

 perform set_config('role','authenticated',true);
 perform public.portal_save_event(event_id,payload||'{"title":"__silent_edit"}');
 perform set_config('role','postgres',true);
 if exists(select 1 from public.member_notifications where member_id=mid and title='__silent_edit') then raise exception 'Silent update notified members'; end if;

 -- Explicit true sends; omitting the choice preserves older clients' delivery.
 perform set_config('role','authenticated',true);
 perform public.portal_save_event(null,payload||'{"title":"__notified_event","notify_members":true}');
 perform public.portal_save_event(null,(payload-'notify_members')||'{"title":"__default_event"}');
 perform set_config('role','postgres',true);
 if (select count(*) from public.member_notifications where member_id=mid and title in ('__notified_event','__default_event'))<>2 then raise exception 'Enabled/default notifications were lost'; end if;

 perform set_config('role','authenticated',true);
 denied:=false;
 begin perform public.portal_save_event(null,payload||'{"notify_members":"false"}'); exception when others then denied:=sqlerrm='Choose whether to notify members'; end;
 if not denied then raise exception 'Non-boolean choice accepted'; end if;
 denied:=false;
 begin perform public.portal_save_event(null,payload||'{"title":""}'); exception when others then denied:=true; end;
 if not denied then raise exception 'Invalid event accepted'; end if;
 if current_setting('portal.event_notifications',true)='off' then raise exception 'Failed save leaked silent setting'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',mu,'role','authenticated')::text,true);
 denied:=false;
 begin perform public.portal_save_event(null,payload); exception when others then denied:=true; end;
 if not denied then raise exception 'Member created event without permission'; end if;
 perform set_config('role','postgres',true);
end $$;
rollback;
select 'Event notification choice checks passed; all fixtures rolled back.' as result;
