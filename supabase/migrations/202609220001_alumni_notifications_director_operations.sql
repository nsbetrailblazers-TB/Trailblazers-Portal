-- Trailblazers Portal: alumni directory, member notifications, and director tools.
-- Apply through the Supabase SQL editor or the Supabase CLI before deploying the
-- accompanying frontend and Edge Function.

create extension if not exists pgcrypto;

create table if not exists public.alumni_profiles (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid references public.cohorts(id) on delete set null,
  first_name text not null,
  last_name text not null,
  preferred_name text,
  graduation_year integer,
  major text,
  current_company text,
  current_title text,
  linkedin_url text,
  contact_email text,
  contact_visible boolean not null default false,
  directory_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The directory view deliberately omits private email addresses.
create or replace view public.alumni_directory as
select
  a.id,
  a.first_name,
  a.last_name,
  a.preferred_name,
  a.graduation_year,
  a.major,
  a.current_company,
  a.current_title,
  a.linkedin_url,
  case when a.contact_visible then a.contact_email else null end as contact_email,
  a.contact_visible,
  c.name as cohort_name,
  c.class_number
from public.alumni_profiles a
left join public.cohorts c on c.id = a.cohort_id
where a.directory_visible = true;

create table if not exists public.member_notification_preferences (
  member_id uuid primary key references public.members(id) on delete cascade,
  email_enabled boolean not null default true,
  announcement_email_enabled boolean not null default true,
  resource_email_enabled boolean not null default true,
  meeting_email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.member_notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  notification_type text not null check (notification_type in ('announcement', 'resource', 'one_on_one', 'event', 'accountability', 'system')),
  title text not null,
  body text,
  target_page text,
  read_at timestamptz,
  email_status text not null default 'queued' check (email_status in ('queued', 'sent', 'skipped', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists member_notifications_member_created_idx
  on public.member_notifications(member_id, created_at desc);

-- Cohort-scoped content; legacy records remain available to all cohorts.
alter table public.announcements add column if not exists cohort_id uuid references public.cohorts(id) on delete cascade;
alter table public.resources add column if not exists cohort_id uuid references public.cohorts(id) on delete cascade;

alter table public.alumni_profiles enable row level security;
alter table public.member_notification_preferences enable row level security;
alter table public.member_notifications enable row level security;

create policy "members read their own notification preferences"
  on public.member_notification_preferences for select to authenticated
  using (member_id in (select id from public.members where auth_user_id = auth.uid()));

create policy "members update their own notification preferences"
  on public.member_notification_preferences for update to authenticated
  using (member_id in (select id from public.members where auth_user_id = auth.uid()))
  with check (member_id in (select id from public.members where auth_user_id = auth.uid()));

create policy "members read their own notifications"
  on public.member_notifications for select to authenticated
  using (member_id in (select id from public.members where auth_user_id = auth.uid()));

revoke all on public.alumni_profiles from authenticated;
grant select on public.alumni_directory to authenticated;

create or replace function public.current_director_assignment()
returns public.director_assignments
language sql
security definer
set search_path = public
stable
as $$
  select da.*
  from public.director_assignments da
  join public.directors d on d.id = da.director_id
  where d.auth_user_id = auth.uid()
    and d.active = true
    and da.active = true
  limit 1;
$$;

create or replace function public.director_schedule_one_on_one(
  p_member_id uuid,
  p_scheduled_date timestamptz,
  p_meeting_method text,
  p_location_method text default null
)
returns public.one_on_ones
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment public.director_assignments;
  scheduled public.one_on_ones;
begin
  select * into assignment from public.current_director_assignment();
  if assignment.id is null then
    raise exception 'You do not have an active director assignment.';
  end if;

  if not exists (
    select 1 from public.members m
    where m.id = p_member_id and m.cohort_id = assignment.cohort_id
  ) then
    raise exception 'This member is not in your assigned cohort.';
  end if;

  if p_scheduled_date <= now() then
    raise exception 'One-on-ones must be scheduled in the future.';
  end if;

  insert into public.one_on_ones (
    member_id, director_id, director_assignment_id, status,
    scheduled_date, meeting_method, location_method
  ) values (
    p_member_id, assignment.director_id, assignment.id, 'scheduled',
    p_scheduled_date, p_meeting_method, p_location_method
  ) returning * into scheduled;

  return scheduled;
end;
$$;

create or replace function public.publish_cohort_announcement(
  p_title text,
  p_body text
)
returns public.announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment public.director_assignments;
  announcement public.announcements;
begin
  select * into assignment from public.current_director_assignment();
  if assignment.id is null then raise exception 'You do not have an active director assignment.'; end if;

  insert into public.announcements (title, body, active, publish_at, cohort_id)
  values (left(trim(p_title), 140), trim(p_body), true, now(), assignment.cohort_id)
  returning * into announcement;

  return announcement;
end;
$$;

create or replace function public.publish_cohort_resource(
  p_title text,
  p_category text,
  p_url text,
  p_description text default null
)
returns public.resources
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment public.director_assignments;
  resource public.resources;
begin
  select * into assignment from public.current_director_assignment();
  if assignment.id is null then raise exception 'You do not have an active director assignment.'; end if;
  if p_url !~ '^https?://' then raise exception 'Provide a valid http(s) link.'; end if;

  insert into public.resources (title, category, description, external_url, active, cohort_id)
  values (left(trim(p_title), 140), trim(p_category), nullif(trim(p_description), ''), trim(p_url), true, assignment.cohort_id)
  returning * into resource;

  return resource;
end;
$$;

create or replace function public.enqueue_cohort_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_title text;
  notification_body text;
  notification_type text;
  target_page text;
  target_cohort_id uuid;
begin
  if tg_table_name = 'announcements' then
    if not new.active then return new; end if;
    notification_title := case when tg_op = 'INSERT' then 'New announcement: ' else 'Announcement updated: ' end || new.title;
    notification_body := new.body;
    notification_type := 'announcement';
    target_page := 'nsbe';
    target_cohort_id := new.cohort_id;
  elsif tg_table_name = 'resources' then
    if not new.active then return new; end if;
    notification_title := case when tg_op = 'INSERT' then 'New resource: ' else 'Resource updated: ' end || new.title;
    notification_body := coalesce(new.description, 'A resource is available in the portal.');
    notification_type := 'resource';
    target_page := 'resources';
    target_cohort_id := new.cohort_id;
  else
    if not new.active then
      notification_title := 'Event canceled: ' || new.title;
    else
      notification_title := case when tg_op = 'INSERT' then 'New event: ' else 'Event updated: ' end || new.title;
    end if;
    notification_body := coalesce(new.description, 'Check the calendar for the latest details.');
    notification_type := 'event';
    target_page := 'calendar';
    target_cohort_id := new.cohort_id;
  end if;

  if target_cohort_id is null then return new; end if;

  insert into public.member_notifications (member_id, notification_type, title, body, target_page)
  select m.id, notification_type, notification_title, notification_body, target_page
  from public.members m
  where m.cohort_id = target_cohort_id;

  return new;
end;
$$;

create or replace function public.enqueue_one_on_one_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'scheduled' then
    insert into public.member_notifications (member_id, notification_type, title, body, target_page)
    values (
      new.member_id,
      'one_on_one',
      case when tg_op = 'INSERT' then 'New one-on-one scheduled' else 'One-on-one updated' end,
      'Your one-on-one is scheduled for ' || to_char(new.scheduled_date at time zone 'America/New_York', 'Mon FMDD at FMHH12:MI AM') || '.',
      'oneonones'
    );
  elsif old.status = 'scheduled' and new.status <> 'scheduled' then
    insert into public.member_notifications (member_id, notification_type, title, body, target_page)
    values (new.member_id, 'one_on_one', 'One-on-one updated', 'A one-on-one on your schedule was updated.', 'oneonones');
  end if;
  return new;
end;
$$;

drop trigger if exists announcements_notify_members on public.announcements;
create trigger announcements_notify_members
after insert or update of title, body, active, publish_at on public.announcements
for each row execute function public.enqueue_cohort_notifications();

drop trigger if exists resources_notify_members on public.resources;
create trigger resources_notify_members
after insert or update of title, description, active, external_url on public.resources
for each row execute function public.enqueue_cohort_notifications();

drop trigger if exists meetings_notify_members on public.meetings;
create trigger meetings_notify_members
after insert or update of title, description, start_time, end_time, location, active on public.meetings
for each row execute function public.enqueue_cohort_notifications();

drop trigger if exists one_on_ones_notify_member on public.one_on_ones;
create trigger one_on_ones_notify_member
after insert or update of scheduled_date, status, location_method, meeting_method on public.one_on_ones
for each row execute function public.enqueue_one_on_one_notification();

create or replace function public.mark_my_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.member_notifications n
  set read_at = coalesce(n.read_at, now())
  from public.members m
  where n.member_id = m.id and m.auth_user_id = auth.uid();
$$;

revoke all on function public.current_director_assignment() from public;
revoke all on function public.director_schedule_one_on_one(uuid, timestamptz, text, text) from public;
revoke all on function public.publish_cohort_announcement(text, text) from public;
revoke all on function public.publish_cohort_resource(text, text, text, text) from public;
revoke all on function public.mark_my_notifications_read() from public;
grant execute on function public.director_schedule_one_on_one(uuid, timestamptz, text, text) to authenticated;
grant execute on function public.publish_cohort_announcement(text, text) to authenticated;
grant execute on function public.publish_cohort_resource(text, text, text, text) to authenticated;
grant execute on function public.mark_my_notifications_read() to authenticated;
