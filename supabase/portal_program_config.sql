do $$ declare definition text; begin
 select pg_get_functiondef('portal_private.workspace(text,uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'''portal_name'',''point_requirement'',''alumni_directory_enabled'',''point_deadline''','''portal_name'',''point_requirement'',''alumni_directory_enabled'',''point_deadline'',''program_year'',''current_cohort''');
 execute definition;
end $$;
