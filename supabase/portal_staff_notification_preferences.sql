-- Apply before deploying the updated send-notification-email function and portal.
-- Preferences belong to an authenticated account and cover both staff views.
begin;
create table if not exists public.staff_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  points_email_enabled boolean not null default true,
  meetings_email_enabled boolean not null default true,
  resumes_email_enabled boolean not null default true,
  excuses_email_enabled boolean not null default true,
  birthdays_email_enabled boolean not null default true,
  portal_email_enabled boolean not null default true
);
alter table public.staff_notification_preferences enable row level security;
revoke all on public.staff_notification_preferences from public, anon, authenticated;
grant select, insert, update on public.staff_notification_preferences to authenticated;
grant select on public.staff_notification_preferences to service_role;

create policy staff_preferences_read on public.staff_notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy staff_preferences_insert on public.staff_notification_preferences
  for insert to authenticated with check (
    user_id = (select auth.uid()) and (
      portal_private.is_admin() or exists (
        select 1 from public.directors d
        where d.auth_user_id = (select auth.uid()) and d.active
      )
    )
  );
create policy staff_preferences_update on public.staff_notification_preferences
  for update to authenticated using (
    user_id = (select auth.uid()) and (
      portal_private.is_admin() or exists (
        select 1 from public.directors d
        where d.auth_user_id = (select auth.uid()) and d.active
      )
    )
  ) with check (
    user_id = (select auth.uid()) and (
      portal_private.is_admin() or exists (
        select 1 from public.directors d
        where d.auth_user_id = (select auth.uid()) and d.active
      )
    )
  );
commit;
