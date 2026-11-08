create table public.portal_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  email_status text not null default 'queued'
    check (email_status in ('queued', 'sending', 'sent', 'skipped', 'failed')),
  created_at timestamptz not null default now(),
  dedupe_key text unique
);

alter table public.portal_admin_notifications enable row level security;
revoke all on public.portal_admin_notifications from public, anon, authenticated;
grant select, update on public.portal_admin_notifications to service_role;

create or replace function portal_private.notify_point_submission_admins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member public.members%rowtype;
  v_admin_user_id uuid;
  v_body text;
begin
  if new.status not in ('pending', 'needs_review') then
    return new;
  end if;

  select m.* into v_member from public.members m where m.id = new.member_id;
  if not found or v_member.program_status <> 'active' or v_member.cohort_id is null
     or not exists (
       select 1 from public.cohorts c
       where c.id = v_member.cohort_id and c.status = 'active'
     ) then
    return new;
  end if;

  v_body := coalesce(v_member.preferred_name, v_member.first_name) || ' ' || v_member.last_name ||
    ' submitted ' || new.activity_name || ' for ' || new.points_requested::text || ' points' ||
    case when new.activity_date is null then '' else ' on ' || to_char(new.activity_date, 'Mon FMDD, YYYY') end ||
    '. Open Points in the admin portal to review the submission and evidence.';

  for v_admin_user_id in
    select pa.user_id from public.portal_admins pa where pa.active
  loop
    insert into public.portal_admin_notifications (admin_user_id, title, body, dedupe_key)
    values (
      v_admin_user_id,
      'Points submission ready for review',
      v_body,
      'point-submission:' || new.id::text || ':admin:' || v_admin_user_id::text
    ) on conflict (dedupe_key) do nothing;
  end loop;

  return new;
end;
$function$;

revoke all on function portal_private.notify_point_submission_admins() from public, anon, authenticated;
drop trigger if exists point_submission_notify_admins on public.point_submissions;
create trigger point_submission_notify_admins
  after insert on public.point_submissions
  for each row execute function portal_private.notify_point_submission_admins();

-- Reuse the existing notification webhook's endpoint and matching secret header
-- without duplicating that secret in a migration file.
do $migration$
declare
  v_trigger_definition text;
begin
  select pg_get_triggerdef(t.oid)
  into v_trigger_definition
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.director_notifications'::regclass
    and t.tgname = 'public.director_notifications'
    and not t.tgisinternal;

  if v_trigger_definition is null then
    raise exception 'Could not find the existing director notification email webhook.';
  end if;

  v_trigger_definition := replace(
    v_trigger_definition,
    'CREATE TRIGGER "public.director_notifications"',
    'CREATE TRIGGER portal_admin_notification_email'
  );
  v_trigger_definition := replace(
    v_trigger_definition,
    'ON public.director_notifications FOR EACH ROW',
    'ON public.portal_admin_notifications FOR EACH ROW'
  );

  if position('ON public.portal_admin_notifications FOR EACH ROW' in v_trigger_definition) = 0 then
    raise exception 'Could not safely copy the existing notification webhook trigger.';
  end if;

  execute v_trigger_definition;
end;
$migration$;
