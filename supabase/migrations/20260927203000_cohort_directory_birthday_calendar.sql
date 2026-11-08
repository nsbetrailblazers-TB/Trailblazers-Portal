create or replace function public.portal_cohort_directory(p_cohort_id uuid default null)
returns table(
  member_id uuid,
  display_name text,
  major text,
  minor text,
  college text,
  graduation_year integer,
  email text,
  linkedin_url text,
  birthday_month integer,
  birthday_day integer
)
language plpgsql stable security definer set search_path='' as $function$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not portal_private.is_admin()
    and not exists(select 1 from public.members me join public.cohorts c on c.id=me.cohort_id
      where me.auth_user_id=auth.uid() and me.program_status='active' and c.status='active')
    and not exists(select 1 from public.directors d join public.director_assignments a on a.director_id=d.id join public.cohorts c on c.id=a.cohort_id
      where d.auth_user_id=auth.uid() and d.active and a.active and c.status='active'
        and (a.start_date is null or a.start_date<=current_date) and (a.end_date is null or a.end_date>=current_date)) then
    raise exception 'Active cohort access required';
  end if;

  return query
  select m.id,coalesce(nullif(trim(m.preferred_name),''),m.first_name)||' '||m.last_name,
    m.major,m.minor,m.college,m.graduation_year,
    case when coalesce(m.show_email,false) then m.uf_email else null end,
    case when coalesce(m.show_linkedin,false) then m.linkedin_url else null end,
    m.birthday_month,m.birthday_day
  from public.members m join public.cohorts c on c.id=m.cohort_id
  where m.program_status='active' and c.status='active'
    and (p_cohort_id is null or m.cohort_id=p_cohort_id)
    and (portal_private.is_admin() or portal_private.can_manage(m.cohort_id)
      or exists(select 1 from public.members me where me.auth_user_id=auth.uid() and me.program_status='active'
        and me.cohort_id=m.cohort_id))
  order by lower(coalesce(nullif(trim(m.preferred_name),''),m.first_name)||' '||m.last_name);
end;
$function$;
revoke all on function public.portal_cohort_directory(uuid) from public,anon;
grant execute on function public.portal_cohort_directory(uuid) to authenticated;

-- Give honest error messages when a stale resume review is submitted twice.
do $migration$
declare definition text;
begin
  select pg_get_functiondef('portal_private.mutate(text,uuid,jsonb)'::regprocedure) into definition;
  if position($old$if row_data is null or row_data->>'status'='reviewed' then raise exception 'Resume is missing or already reviewed'; end if;$old$ in definition)=0 then
    raise exception 'Expected resume-review guard was not found';
  end if;
  definition:=replace(definition,
    $old$if row_data is null or row_data->>'status'='reviewed' then raise exception 'Resume is missing or already reviewed'; end if;$old$,
    $new$if row_data is null then raise exception 'Resume submission was not found. Refresh the resume list.'; end if; if row_data->>'status'='reviewed' then raise exception 'This resume has already been reviewed. Refresh the resume list to see the latest status.'; end if;$new$);
  execute definition;
end
$migration$;

-- Reminder templates and jobs are already configured. Enable their scheduled delivery;
-- member email preferences continue to control delivery of email notifications.
update public.portal_settings
set setting_value=jsonb_set(setting_value,'{value}','true'::jsonb,true),updated_at=now()
where setting_key='reminders_enabled';

notify pgrst,'reload schema';
