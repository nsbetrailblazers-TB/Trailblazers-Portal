-- Support the Fall and Spring points deadlines shown in the 2026-2027 guide.
-- The existing point_deadline setting remains the Fall deadline for compatibility.
do $migration$
declare
  source text;
  updated text;
begin
  select pg_get_functiondef('portal_private.workspace(text,uuid,jsonb)'::regprocedure) into source;
  updated:=replace(source,
    $old$'portal_name','point_requirement','alumni_directory_enabled','point_deadline','program_year','current_cohort'$old$,
    $new$'portal_name','point_requirement','alumni_directory_enabled','point_deadline','spring_point_deadline','program_year','current_cohort'$new$);
  if updated=source then raise exception 'Could not add the Spring deadline to portal config'; end if;
  execute updated;

  select pg_get_functiondef('portal_private.mutate(text,uuid,jsonb)'::regprocedure) into source;
  updated:=replace(source,
    $old$if payload->>'setting_key'='point_deadline' and payload->'setting_value'->>'value' is not null then perform (payload->'setting_value'->>'value')::date; end if;$old$,
    $new$if payload->>'setting_key' in ('point_deadline','spring_point_deadline') and payload->'setting_value'->>'value' is not null then perform (payload->'setting_value'->>'value')::date; end if;$new$);
  if updated=source then raise exception 'Could not add Spring deadline validation'; end if;
  execute updated;

  select pg_get_functiondef('portal_private.scheduled_reminders()'::regprocedure) into source;
  updated:=replace(source,
    $old$select (setting_value->>'value')::date into due from public.portal_settings where setting_key='point_deadline';$old$,
    $new$if extract(month from today) between 1 and 4 then
  select (setting_value->>'value')::date into due from public.portal_settings where setting_key='spring_point_deadline';
else
  select (setting_value->>'value')::date into due from public.portal_settings where setting_key='point_deadline';
end if;$new$);
  if updated=source then raise exception 'Could not update reminder deadline selection'; end if;
  execute updated;
end
$migration$;

insert into public.portal_settings(setting_key,setting_value,description)
values('spring_point_deadline','{"value":"2027-04-25"}'::jsonb,'Spring 2027 points deadline from the 2026-2027 Trailblazers points guide.')
on conflict(setting_key) do update
set setting_value=excluded.setting_value,description=excluded.description,updated_at=now();
