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
    select pa.user_id
    from public.portal_admins pa
    where pa.active
      and not exists (
        select 1
        from public.directors d
        join public.director_assignments a on a.director_id = d.id
        join public.cohorts c on c.id = a.cohort_id
        where d.auth_user_id = pa.user_id and d.active and a.active and c.status = 'active'
          and a.cohort_id = v_member.cohort_id and 'points' = any(a.capabilities)
          and (a.start_date is null or a.start_date <= current_date)
          and (a.end_date is null or a.end_date >= current_date)
      )
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
