begin;
do $$
declare cid uuid; mid uuid; did uuid; today date:=(now() at time zone 'America/New_York')::date; before_count integer;
begin
 insert into public.cohorts(name,class_number,status,point_requirement) values('__reminder_test',99113,'active',10) returning id into cid;
 insert into public.members(first_name,last_name,uf_email,cohort_id,program_status,birthday_month,birthday_day) values('Reminder','Member','reminder@example.invalid',cid,'active',extract(month from today),extract(day from today)) returning id into mid;
 insert into public.directors(first_name,last_name,email,active) values('Reminder','Director','reminder-director@example.invalid',true) returning id into did;
 insert into public.director_assignments(director_id,cohort_id,title,active) values(did,cid,'Director',true);
 update public.one_on_ones set status='scheduled',scheduled_date=now()+interval '3 hours' where member_id=mid and director_id=did;
 insert into public.portal_settings(setting_key,setting_value) values('point_deadline',jsonb_build_object('value',today+2)),('reminders_enabled','{"value":true}') on conflict(setting_key) do update set setting_value=excluded.setting_value;
 perform portal_private.scheduled_reminders();
 if not exists(select 1 from public.member_notifications where member_id=mid and dedupe_key like 'birthday:%') then raise exception 'Birthday missing';end if;
 if not exists(select 1 from public.director_notifications where director_id=did and dedupe_key like 'birthday:%') then raise exception 'Director birthday missing';end if;
 if not exists(select 1 from public.member_notifications where member_id=mid and notification_type='one_on_one' and dedupe_key like 'meeting:%') then raise exception 'Meeting reminder missing';end if;
 if not exists(select 1 from public.member_notifications where member_id=mid and dedupe_key like 'deadline:%') then raise exception 'Deadline reminder missing';end if;
 select count(*) into before_count from public.member_notifications where member_id=mid;
 perform portal_private.scheduled_reminders();
 if (select count(*) from public.member_notifications where member_id=mid)<>before_count then raise exception 'Repeated reminders duplicated';end if;
end $$;
rollback;
