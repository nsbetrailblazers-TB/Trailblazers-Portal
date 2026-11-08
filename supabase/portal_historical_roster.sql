-- Permit historical roster entry without reactivating archived cohorts.
do $$ declare definition text; begin
 select pg_get_functiondef('portal_private.mutate(text,uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,
  '(rid is null or payload->>''program_status''=''active'')',
  '(coalesce(payload->>''program_status'',''active'')=''active'')');
 definition:=replace(definition,
  'insert into public.members(first_name,last_name,preferred_name,uf_email,cohort_id,member_id)',
  'insert into public.members(first_name,last_name,preferred_name,uf_email,cohort_id,member_id,program_status)');
 definition:=replace(definition,
  'cid,nullif(trim(payload->>''member_id''),'''')) returning id into rid;',
  'cid,nullif(trim(payload->>''member_id''),''''),coalesce(payload->>''program_status'',''active'')) returning id into rid;');
 execute definition;
end $$;
