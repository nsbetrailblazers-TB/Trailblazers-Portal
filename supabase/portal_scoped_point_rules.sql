alter table public.point_rules add column if not exists cohort_id uuid references public.cohorts(id);
drop policy rules_read on public.point_rules;
create policy rules_read on public.point_rules for select to authenticated using
 (portal_private.can_manage(cohort_id,'points') or (active and portal_private.member_cohort(cohort_id)));
do $$declare d text;begin
 select pg_get_functiondef('portal_private.guard_write()'::regprocedure) into d;
 d:=replace(d,'''portal_settings'',''email_templates'',''point_rules''','''portal_settings'',''email_templates''');
 d:=replace(d,'''announcements'',''resources'',''meetings''','''announcements'',''resources'',''meetings'',''point_rules''');
 d:=replace(d,'case when tg_table_name=''meetings'' then ''events'' else ''content'' end','case when tg_table_name=''meetings'' then ''events'' when tg_table_name=''point_rules'' then ''points'' else ''content'' end');
 execute d;
 select pg_get_functiondef('portal_private.workspace(text,uuid,jsonb)'::regprocedure) into d;
 d:=replace(d,'if not portal_private.is_admin() then raise exception ''Administrator access required for global point rules''; end if;', $body$
 cid:=(payload->>'cohort_id')::uuid;
 if rid is not null then select cohort_id into cid from public.point_rules where id=rid; if not found then raise exception 'Rule not found'; end if; end if;
 if not portal_private.can_manage(cid,'points') then raise exception 'Point-rule permission required'; end if;
 $body$);
 d:=replace(d,'insert into public.point_rules(id,name,description,default_points,category,active)','insert into public.point_rules(id,cohort_id,name,description,default_points,category,active)');
 d:=replace(d,$old$values(coalesce(rid,gen_random_uuid()),nullif(trim(payload->>'name'),''),payload->>'description'$old$,$new$values(coalesce(rid,gen_random_uuid()),cid,nullif(trim(payload->>'name'),''),payload->>'description'$new$);
 execute d;
end $$;
notify pgrst,'reload schema';
