do $$declare d text;begin
 select pg_get_functiondef('portal_private.workspace(text,uuid,jsonb)'::regprocedure) into d;
 d:=replace(d,' if operation=''member_save'' then',$body$
 if operation='care_directory' then
  cid:=(payload->>'cohort_id')::uuid;
  if not portal_private.can_manage(cid,'care') then raise exception 'Dietary/accessibility permission required'; end if;
  return coalesce((select jsonb_agg(to_jsonb(c)) from portal_private.member_care c join public.members m on m.id=c.member_id where (cid is null or m.cohort_id=cid) and portal_private.can_manage(m.cohort_id,'care')),'[]');
 elsif operation='member_save' then$body$);
 execute d;
end $$;
notify pgrst,'reload schema';
