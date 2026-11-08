-- Preserve submission history: a reset clears awarded totals, never deletes evidence.
create or replace function portal_private.reset_points(target_member uuid, confirmation text)
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if auth.uid() is null or not portal_private.is_admin() then raise exception 'Administrator access required'; end if;
 if confirmation is distinct from 'RESET' then raise exception 'Type RESET to confirm'; end if;
 if target_member is not null and not exists(select 1 from public.members where id=target_member and program_status='active') then raise exception 'Choose an active Trailblazer'; end if;
 update public.point_submissions p set points_awarded=0
 where p.status='approved' and coalesce(p.points_awarded,0)<>0
 and exists(select 1 from public.members m where m.id=p.member_id and m.program_status='active' and (target_member is null or m.id=target_member));
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function portal_private.reset_points(uuid,text) from public,anon;
grant execute on function portal_private.reset_points(uuid,text) to authenticated;
create or replace function public.portal_reset_points(target_member uuid default null, confirmation text default '')
returns integer language sql security invoker set search_path='' as $$ select portal_private.reset_points(target_member,confirmation); $$;
revoke all on function public.portal_reset_points(uuid,text) from public,anon;
grant execute on function public.portal_reset_points(uuid,text) to authenticated;

-- Active member resumes remain available even when their cohort is archived.
create or replace function portal_private.can_submit_resume() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.members where auth_user_id=auth.uid() and program_status='active');
$$;
revoke all on function portal_private.can_submit_resume() from public,anon;
grant execute on function portal_private.can_submit_resume() to authenticated;
create policy private_resume_upload on storage.objects for insert to authenticated with check
 (bucket_id='trailblazers-private' and (storage.foldername(name))[1]=auth.uid()::text
 and lower(name) like '%.pdf' and metadata->>'mimetype'='application/pdf' and portal_private.can_submit_resume());
do $$ declare definition text; begin
 select pg_get_functiondef('portal_private.submit_file(text,text,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'if not portal_private.owns_member(mid,true) then', 'if not (case when kind=''resume'' then portal_private.can_submit_resume() else portal_private.owns_member(mid,true) end) then');
 -- Use a suffix check rather than an overescaped regular expression.
 definition:=regexp_replace(definition,'path !~\* ''[^'']*pdf\$''', 'lower(path) not like ''%.pdf''');
 execute definition;
 select pg_get_functiondef('portal_private.guard_write()'::regprocedure) into definition;
 definition:=replace(definition,'if portal_private.owns_member(mid,true) then','if portal_private.owns_member(mid,true) or (tg_table_name=''resume_submissions'' and portal_private.can_submit_resume() and portal_private.owns_member(mid)) then');
 execute definition;
end $$;
