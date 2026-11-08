create table public.excuse_submissions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  submitted_by_user_id uuid not null references auth.users(id) on delete restrict,
  absence_type text not null check (absence_type in ('absent', 'late', 'leaving_early')),
  missed_at timestamptz not null,
  reason text not null check (length(trim(reason)) between 1 and 2000),
  proof_path text not null unique,
  notified_director_id uuid references public.directors(id) on delete set null,
  submitted_at timestamptz not null default now(),
  constraint excuse_proof_path_format check (
    proof_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/excuses/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$'
  )
);

create index excuse_submissions_member_submitted_idx
  on public.excuse_submissions (member_id, submitted_at desc);
create index excuse_submissions_cohort_missed_idx
  on public.excuse_submissions (cohort_id, missed_at);

alter table public.excuse_submissions enable row level security;
revoke all on public.excuse_submissions from public, anon, authenticated;
grant select on public.excuse_submissions to authenticated;
create policy excuse_submission_read
  on public.excuse_submissions for select to authenticated
  using (portal_private.member_access(member_id, 'meetings'));

create or replace function public.portal_excuse_director_options()
returns table (director_id uuid, display_name text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member public.members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to load your director list.';
  end if;

  select m.* into v_member
  from public.members as m
  where m.auth_user_id = auth.uid();

  if not found or v_member.program_status <> 'active' or v_member.cohort_id is null
     or not exists (select 1 from public.cohorts c where c.id = v_member.cohort_id and c.status = 'active') then
    raise exception 'An active Trailblazer account is required.';
  end if;

  return query
  select distinct d.id, concat_ws(' ', d.first_name, d.last_name)
  from public.directors d
  join public.director_assignments a on a.director_id = d.id
  where a.cohort_id = v_member.cohort_id
    and a.active and d.active and 'meetings' = any(a.capabilities)
    and (a.start_date is null or a.start_date <= current_date)
    and (a.end_date is null or a.end_date >= current_date)
  order by 2;
end;
$function$;

create or replace function public.portal_submit_excuse(
  p_absence_type text,
  p_missed_at timestamptz,
  p_reason text,
  p_proof_path text,
  p_notified_director_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member public.members%rowtype;
  v_submission_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before submitting an excuse form.';
  end if;

  select m.* into v_member
  from public.members m
  where m.auth_user_id = auth.uid();

  if not found or v_member.program_status <> 'active' or v_member.cohort_id is null
     or not exists (select 1 from public.cohorts c where c.id = v_member.cohort_id and c.status = 'active') then
    raise exception 'An active Trailblazer account is required to submit an excuse form.';
  end if;
  if p_absence_type is null or p_absence_type not in ('absent', 'late', 'leaving_early') then
    raise exception 'Choose absent, late, or leaving early.';
  end if;
  if p_missed_at is null or p_missed_at <= now() then
    raise exception 'Choose a future date and time.';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then
    raise exception 'Enter a reason of 1 to 2000 characters.';
  end if;
  if p_missed_at < now() + interval '24 hours' and p_notified_director_id is null then
    raise exception 'Select the director you notified for requests submitted less than 24 hours in advance.';
  end if;
  if p_notified_director_id is not null and not exists (
    select 1
    from public.directors d
    join public.director_assignments a on a.director_id = d.id
    where d.id = p_notified_director_id
      and d.active and a.active and a.cohort_id = v_member.cohort_id
      and 'meetings' = any(a.capabilities)
      and (a.start_date is null or a.start_date <= current_date)
      and (a.end_date is null or a.end_date >= current_date)
  ) then
    raise exception 'Choose an active director assigned to your cohort.';
  end if;
  if p_proof_path is null or p_proof_path !~ (
    '^' || auth.uid()::text || '/excuses/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$'
  ) then
    raise exception 'Upload proof using the secure excuse-form upload.';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'trailblazers-private' and o.name = p_proof_path
  ) then
    raise exception 'The uploaded proof could not be found. Please upload it again.';
  end if;

  insert into public.excuse_submissions (
    member_id, cohort_id, submitted_by_user_id, absence_type, missed_at,
    reason, proof_path, notified_director_id
  ) values (
    v_member.id, v_member.cohort_id, auth.uid(), p_absence_type, p_missed_at,
    trim(p_reason), p_proof_path, p_notified_director_id
  ) returning id into v_submission_id;

  return v_submission_id;
end;
$function$;

revoke all on function public.portal_excuse_director_options() from public, anon;
revoke all on function public.portal_submit_excuse(text, timestamptz, text, text, uuid) from public, anon;
grant execute on function public.portal_excuse_director_options() to authenticated;
grant execute on function public.portal_submit_excuse(text, timestamptz, text, text, uuid) to authenticated;

create or replace function portal_private.enqueue_excuse_director_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member public.members%rowtype;
begin
  if new.notified_director_id is null then
    return new;
  end if;

  select m.* into v_member from public.members m where m.id = new.member_id;
  if not found then
    return new;
  end if;

  insert into public.director_notifications (director_id, title, body, dedupe_key)
  values (
    new.notified_director_id,
    'Excuse form submitted',
    coalesce(v_member.preferred_name, v_member.first_name) || ' ' || v_member.last_name ||
      ' submitted a ' || replace(new.absence_type, '_', ' ') || ' notice for ' ||
      to_char(new.missed_at at time zone 'America/New_York', 'Mon FMDD, YYYY at FMHH12:MI AM') ||
      '. Open Excuse forms in the portal to review the reason and proof.',
    'excuse-submission:' || new.id::text || ':' || new.notified_director_id::text
  ) on conflict (dedupe_key) do nothing;

  return new;
end;
$function$;

revoke all on function portal_private.enqueue_excuse_director_notification() from public, anon, authenticated;
drop trigger if exists excuse_submission_notify_director on public.excuse_submissions;
create trigger excuse_submission_notify_director
  after insert on public.excuse_submissions
  for each row execute function portal_private.enqueue_excuse_director_notification();

create or replace function portal_private.notify_point_submission_directors()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member public.members%rowtype;
  v_director public.directors%rowtype;
begin
  if new.status not in ('pending', 'needs_review') then
    return new;
  end if;

  select m.* into v_member from public.members m where m.id = new.member_id;
  if not found or v_member.program_status <> 'active' or v_member.cohort_id is null
     or not exists (select 1 from public.cohorts c where c.id = v_member.cohort_id and c.status = 'active') then
    return new;
  end if;

  for v_director in
    select distinct d.*
    from public.directors d
    join public.director_assignments a on a.director_id = d.id
    where a.cohort_id = v_member.cohort_id
      and a.active and d.active and 'points' = any(a.capabilities)
      and (a.start_date is null or a.start_date <= current_date)
      and (a.end_date is null or a.end_date >= current_date)
  loop
    insert into public.director_notifications (director_id, title, body, dedupe_key)
    values (
      v_director.id,
      'Points submission ready for review',
      coalesce(v_member.preferred_name, v_member.first_name) || ' ' || v_member.last_name ||
        ' submitted ' || new.activity_name || ' for ' || new.points_requested::text || ' points' ||
        case when new.activity_date is null then '' else ' on ' || to_char(new.activity_date, 'Mon FMDD, YYYY') end ||
        '. Open Points in the director portal to review the submission and evidence.',
      'point-submission:' || new.id::text || ':' || v_director.id::text
    ) on conflict (dedupe_key) do nothing;
  end loop;

  return new;
end;
$function$;

revoke all on function portal_private.notify_point_submission_directors() from public, anon, authenticated;
drop trigger if exists point_submission_notify_directors on public.point_submissions;
create trigger point_submission_notify_directors
  after insert on public.point_submissions
  for each row execute function portal_private.notify_point_submission_directors();

drop policy if exists private_download on storage.objects;
create policy private_download on storage.objects for select to authenticated
using (
  bucket_id = 'trailblazers-private'
  and (
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (
        select 1 from public.members m
        where m.auth_user_id = auth.uid() and m.program_status <> 'inactive'
      )
    )
    or exists (
      select 1 from public.resume_submissions r
      where r.file_path = objects.name and portal_private.member_access(r.member_id, 'resumes')
    )
    or exists (
      select 1 from public.point_submissions p
      where p.evidence_path = objects.name and portal_private.member_access(p.member_id, 'points')
    )
    or exists (
      select 1 from public.excuse_submissions e
      where e.proof_path = objects.name and portal_private.member_access(e.member_id, 'meetings')
    )
  )
);

drop policy if exists private_cleanup on storage.objects;
create policy private_cleanup on storage.objects for delete to authenticated
using (
  bucket_id = 'trailblazers-private'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (select 1 from public.resume_submissions r where r.file_path = objects.name)
  and not exists (select 1 from public.point_submissions p where p.evidence_path = objects.name)
  and not exists (select 1 from public.members m where m.photo_path = objects.name)
  and not exists (select 1 from public.excuse_submissions e where e.proof_path = objects.name)
);

notify pgrst, 'reload schema';
