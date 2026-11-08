-- Template-based notification queue; hourly reminders remain opt-in until configured.
alter table public.member_notifications add column if not exists dedupe_key text unique;
create table public.director_notifications (
 id uuid primary key default gen_random_uuid(), director_id uuid not null references public.directors(id),
 title text not null, body text, read_at timestamptz, created_at timestamptz not null default now(),
 email_status text not null default 'queued' check(email_status in ('queued','sent','failed','skipped')),
 dedupe_key text unique
);
alter table public.director_notifications enable row level security;
grant select on public.director_notifications to authenticated;
grant all on public.director_notifications to service_role;
create policy director_notification_read on public.director_notifications for select to authenticated using
 (portal_private.is_admin() or exists(select 1 from public.directors d where d.id=director_id and d.auth_user_id=auth.uid() and d.active));
insert into public.email_templates(template_key,name,subject,body) values
 ('strike_removed','Strike removed','Accountability update','Hi {{preferred_name}}, a strike has been removed from your record. Review your portal for details.'),
 ('event_reminder','Event reminder','Upcoming: {{meeting_title}}','Hi {{preferred_name}}, {{meeting_title}} is coming up at {{meeting_time}}. Location: {{location}}.'),
 ('point_deadline','Points deadline','Your points deadline is approaching','Hi {{preferred_name}}, you have {{total_points}} approved points. Your cohort requirement is {{points_required}}. Deadline: {{deadline}}.'),
 ('low_points','Points progress reminder','Your Trailblazers points progress','Hi {{preferred_name}}, you have {{total_points}} of {{points_required}} required points. Open the portal to review your progress.'),
 ('birthday_member','Birthday greeting','Happy birthday, {{preferred_name}}','Happy birthday from the Trailblazers team!'),
 ('incomplete_profile','Profile reminder','Complete your Trailblazers profile','Hi {{preferred_name}}, please add your major, graduation year, and preferred contact details.'),
 ('scheduled_announcement','Published announcement','{{announcement_title}}','{{announcement_body}}')
 on conflict(template_key) do nothing;
insert into public.portal_settings(setting_key,setting_value,description) values
 ('reminders_enabled','{"value":false}','Enable scheduled in-app and queued email reminders after reviewing templates and delivery configuration.') on conflict(setting_key) do nothing;

create function portal_private.queue_template(mid uuid, template text, variables jsonb, dedupe text, destination text default 'home') returns void
language plpgsql security definer set search_path='' as $$
declare t public.email_templates; m public.members; k text; v text; total integer;
begin
 select * into t from public.email_templates where template_key=template and active;
 if not found then return; end if;
 select * into m from public.members where id=mid;
 if not found then return; end if;
 select coalesce(sum(points_awarded),0) into total from public.point_submissions where member_id=mid and status='approved';
 variables:=coalesce(variables,'{}')||jsonb_build_object('preferred_name',coalesce(m.preferred_name,m.first_name),'total_points',total);
 for k,v in select key,value from jsonb_each_text(variables) loop
  t.subject:=replace(t.subject,'{{'||k||'}}',coalesce(v,''));t.body:=replace(t.body,'{{'||k||'}}',coalesce(v,''));
 end loop;
 insert into public.member_notifications(member_id,notification_type,title,body,target_page,dedupe_key)
 values(mid,case when template='event_reminder' then 'event' when template='meeting_reminder' then 'one_on_one' when template='scheduled_announcement' then 'announcement' else 'system' end,t.subject,t.body,destination,dedupe)
 on conflict(dedupe_key) do nothing;
end $$;
revoke all on function portal_private.queue_template(uuid,text,jsonb,text,text) from public,anon,authenticated;

create function portal_private.inventory_notifications() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='point_submissions' then
  if tg_op='INSERT' then perform portal_private.queue_template(new.member_id,'point_received',to_jsonb(new),'point-received:'||new.id,'points');
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
create trigger inventory_notification after insert or update on public.point_submissions for each row execute function portal_private.inventory_notifications();
create trigger inventory_notification after insert or update on public.strikes for each row execute function portal_private.inventory_notifications();
create trigger inventory_notification after insert or update on public.members for each row execute function portal_private.inventory_notifications();
-- New template triggers replace the two generic mutation notifications.
do $$declare d text;begin
 select pg_get_functiondef('portal_private.mutate(text,uuid,jsonb)'::regprocedure) into d;
 d:=replace(d,'insert into public.member_notifications(member_id,notification_type,title,body,target_page) values(mid,''accountability'',''Points ''||case when desired=''denied'' then ''rejected'' else desired end,payload->>''director_note'',''points'');','null;');
 d:=replace(d,'insert into public.member_notifications(member_id,notification_type,title,body,target_page) values(mid,''accountability'',''Strike record updated'',''Review your accountability record in the portal.'',''home'');','null;');
 execute d;
end $$;

create function portal_private.scheduled_reminders() returns void language plpgsql security definer set search_path='' as $$
declare m record; e record; d record; a record; due date; today date:=(now() at time zone 'America/New_York')::date; stamp text; total integer; vars jsonb;
begin
 if not exists(select 1 from public.portal_settings where setting_key='reminders_enabled' and setting_value->>'value'='true') then return; end if;
 perform pg_advisory_xact_lock(hashtext('trailblazers_scheduled_reminders'));
 select (setting_value->>'value')::date into due from public.portal_settings where setting_key='point_deadline';
 for m in select m.*,c.point_requirement from public.members m join public.cohorts c on c.id=m.cohort_id where m.program_status='active' and c.status='active' loop
  select coalesce(sum(points_awarded),0) into total from public.point_submissions where member_id=m.id and status='approved';
  vars:=jsonb_build_object('points_required',m.point_requirement,'deadline',due);
  stamp:=m.id||':'||to_char(today,'IYYY-IW');
  if total<m.point_requirement then
   perform portal_private.queue_template(m.id,'low_points',vars,'low-points:'||stamp,'points');
   if due between today and today+7 then perform portal_private.queue_template(m.id,'point_deadline',vars,'deadline:'||m.id||':'||due,'points'); end if;
  end if;
  if m.major is null or m.graduation_year is null or m.preferred_contact_method is null then perform portal_private.queue_template(m.id,'incomplete_profile','{}','profile:'||stamp,'profile'); end if;
  if m.birthday_month=extract(month from today) and m.birthday_day=extract(day from today) then
   perform portal_private.queue_template(m.id,'birthday_member','{}','birthday:'||m.id||':'||today);
   for d in select distinct d.id from public.directors d join public.director_assignments a on a.director_id=d.id where d.active and a.active and a.cohort_id=m.cohort_id and (a.start_date is null or a.start_date<=today) and (a.end_date is null or a.end_date>=today) loop
    insert into public.director_notifications(director_id,title,body,dedupe_key) values(d.id,'Birthday today',coalesce(m.preferred_name,m.first_name)||' '||m.last_name||' has a birthday today.','birthday:'||d.id||':'||m.id||':'||today) on conflict(dedupe_key) do nothing;
   end loop;
  end if;
  for e in select * from public.one_on_ones where member_id=m.id and status='scheduled' and scheduled_date between now() and now()+interval '24 hours' loop
   perform portal_private.queue_template(m.id,'meeting_reminder',jsonb_build_object('meeting_title','In-person one-on-one','meeting_date',to_char(e.scheduled_date at time zone 'America/New_York','Mon DD'),'meeting_time',to_char(e.scheduled_date at time zone 'America/New_York','HH12:MI AM')||' Eastern'),'meeting:'||e.id||':'||e.scheduled_date,'oneOnOnes');
  end loop;
  for e in select * from public.meetings where active and (cohort_id is null or cohort_id=m.cohort_id) and start_time between now() and now()+interval '24 hours' loop
   perform portal_private.queue_template(m.id,'event_reminder',jsonb_build_object('meeting_title',e.title,'meeting_time',case when e.all_day then e.all_day_start::text||' (all day)' else to_char(e.start_time at time zone 'America/New_York','Mon DD HH12:MI AM')||' Eastern' end,'location',case when e.location_tbd then 'TBD' else coalesce(e.location,'TBD') end),'event:'||e.id||':'||e.start_time||':'||m.id,'calendar');
  end loop;
  for a in select * from public.announcements where active and audience='members' and (cohort_id is null or cohort_id=m.cohort_id) and publish_at<=now() and publish_at>now()-interval '2 hours' and (expires_at is null or expires_at>now()) loop
   perform portal_private.queue_template(m.id,'scheduled_announcement',jsonb_build_object('announcement_title',a.title,'announcement_body',a.body),'announcement:'||a.id||':'||m.id,'announcements');
  end loop;
 end loop;
end $$;
revoke all on function portal_private.scheduled_reminders() from public,anon,authenticated;
create extension if not exists pg_cron;
select cron.schedule('trailblazers-hourly-reminders','5 * * * *','select portal_private.scheduled_reminders()');
notify pgrst,'reload schema';
