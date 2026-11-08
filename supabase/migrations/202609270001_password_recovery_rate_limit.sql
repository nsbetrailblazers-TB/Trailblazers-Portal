create table if not exists public.portal_recovery_rate_buckets (
  scope text not null,
  subject_hash text not null,
  window_start timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  primary key (scope, subject_hash, window_start)
);

create index if not exists portal_recovery_rate_buckets_window_idx
  on public.portal_recovery_rate_buckets (window_start);

alter table public.portal_recovery_rate_buckets enable row level security;
revoke all on table public.portal_recovery_rate_buckets from public, anon, authenticated;

create or replace function public.portal_claim_recovery_slot(
  p_email_hash text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email_minute integer;
  v_email_hour integer;
  v_ip_hour integer;
begin
  if p_email_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into public.portal_recovery_rate_buckets as buckets
    (scope, subject_hash, window_start, attempt_count)
  values ('email_minute', p_email_hash, pg_catalog.date_trunc('minute', pg_catalog.now()), 1)
  on conflict (scope, subject_hash, window_start)
  do update set attempt_count = buckets.attempt_count + 1
  returning attempt_count into v_email_minute;

  insert into public.portal_recovery_rate_buckets as buckets
    (scope, subject_hash, window_start, attempt_count)
  values ('email_hour', p_email_hash, pg_catalog.date_trunc('hour', pg_catalog.now()), 1)
  on conflict (scope, subject_hash, window_start)
  do update set attempt_count = buckets.attempt_count + 1
  returning attempt_count into v_email_hour;

  insert into public.portal_recovery_rate_buckets as buckets
    (scope, subject_hash, window_start, attempt_count)
  values ('ip_hour', p_ip_hash, pg_catalog.date_trunc('hour', pg_catalog.now()), 1)
  on conflict (scope, subject_hash, window_start)
  do update set attempt_count = buckets.attempt_count + 1
  returning attempt_count into v_ip_hour;

  delete from public.portal_recovery_rate_buckets
  where window_start < pg_catalog.now() - interval '48 hours';

  return v_email_minute <= 1 and v_email_hour <= 5 and v_ip_hour <= 20;
end;
$$;

revoke all on function public.portal_claim_recovery_slot(text, text) from public, anon, authenticated;
grant execute on function public.portal_claim_recovery_slot(text, text) to service_role;
