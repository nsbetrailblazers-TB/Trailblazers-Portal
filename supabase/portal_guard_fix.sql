-- Trigger records differ by table. JSON extraction avoids planning references
-- to a field that does not exist on the particular NEW/OLD record type.
do $$ declare definition text; col text; cast_type text; begin
 select pg_get_functiondef('portal_private.guard_write()'::regprocedure) into definition;
 foreach col in array array['auth_user_id','user_id','cohort_id','director_id','member_id','archived_at','program_status','status','points_awarded','reviewed_by'] loop
   cast_type:=case when col in ('auth_user_id','user_id','cohort_id','director_id','reviewed_by') then 'uuid' when col='archived_at' then 'timestamptz' when col='points_awarded' then 'integer' else 'text' end;
   definition:=replace(definition,'new.'||col,format('(to_jsonb(new)->>%L)::%s',col,cast_type));
   definition:=replace(definition,'old.'||col,format('(to_jsonb(old)->>%L)::%s',col,cast_type));
 end loop;
 definition:=replace(definition, 'mid<>(to_jsonb(old)', 'mid::text<>(to_jsonb(old)');
 execute definition;
end $$;
