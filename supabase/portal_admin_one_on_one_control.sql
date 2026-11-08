-- Admin corrections use the existing ledger, history and audit triggers.
begin;
do $patch$
declare source text; revised text;
begin
 select pg_get_functiondef('portal_private.one_on_one_completion(text,uuid,jsonb)'::regprocedure) into source;
 revised:=replace(source,
  'if assignment.id is null then raise exception ''Choose a currently assigned director''; end if;',
  'if not portal_private.is_admin() and assignment.id is null then raise exception ''Choose a currently assigned director''; end if;
   if not exists(select 1 from public.directors where id=did) then raise exception ''Choose a director''; end if;');
 if revised=source then raise exception 'Meeting assignment guard changed'; end if;
 source:=revised;
 revised:=replace(source, 'if operation=''request'' then
  if not portal_private.owns_member(person.id,true)',
  'if operation=''reopen'' then
    if not portal_private.is_admin() then raise exception ''Administrator access required''; end if;
    if meeting.id is null or meeting.status<>''completed'' then raise exception ''Choose a completed meeting''; end if;
    if nullif(trim(payload->>''note''),'''') is null then raise exception ''Enter a reason for the correction''; end if;
    update public.one_on_ones set status=''reschedule_needed'',completed_date=null,
     completion_reviewed_by=auth.uid(),completion_reviewed_at=now(),admin_note=trim(payload->>''note'') where id=meeting.id;
    return meeting.id;
   end if;
   if operation=''request'' then
  if not portal_private.owns_member(person.id,true)');
 if revised=source then raise exception 'Meeting operation guard changed'; end if;
 revised:=replace(revised, 'if meeting.status=''completed'' and',
  'if not portal_private.is_admin() and meeting.status=''completed'' and');
 execute revised;

 select pg_get_functiondef('portal_private.record_activity(jsonb)'::regprocedure) into source;
 revised:=replace(source, 'r.completion_source<>''submission''',
  '(r.completion_source<>''submission'' and not portal_private.is_admin())');
 if revised=source then raise exception 'Activity recording guard changed'; end if;
 execute revised;

 select pg_get_functiondef('portal_private.validate_point_activity()'::regprocedure) into source;
 revised:=replace(source, 'if tg_op=''INSERT'' or new.point_rule_id is distinct from old.point_rule_id then',
  'if rule.completion_source=''director_meetings'' and not portal_private.is_admin() then raise exception ''Only administrators can assign or correct one-on-one points''; end if;
   if tg_op=''INSERT'' or new.point_rule_id is distinct from old.point_rule_id then');
 revised:=replace(revised, 'if rule.completion_source=''director_meetings'' then raise exception',
  'if rule.completion_source=''director_meetings'' and not portal_private.is_admin() then raise exception');
 if revised=source then raise exception 'Activity validation changed'; end if;
 execute revised;

 select pg_get_functiondef('portal_private.activity_progress(uuid)'::regprocedure) into source;
 revised:=replace(source, 'then director_count>=director_target else',
  'then director_count>=director_target or coalesce((select sum(p.occurrence_count) from public.point_submissions p
   where p.member_id=mid and p.point_rule_id=r.id and p.status=''approved'' and p.points_awarded>0
   and p.removed_at is null and p.activity_date>=term_start and p.activity_date<=current_date),0)>=r.required_count else');
 if revised=source then raise exception 'Activity progress changed'; end if;
 execute revised;
end $patch$;
notify pgrst,'reload schema';
commit;
