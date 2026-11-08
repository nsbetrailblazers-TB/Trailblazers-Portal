-- Bootstrap only the email explicitly approved by the portal owner.
create table portal_private.pending_admins(email text primary key);
alter table portal_private.pending_admins enable row level security;
insert into portal_private.pending_admins values ('nsbe.trailblazers@gmail.com');
revoke all on portal_private.pending_admins from public,anon,authenticated;

do $$ declare definition text; begin
 select pg_get_functiondef('portal_private.guard_write()'::regprocedure) into definition;
 definition:=replace(definition,' if portal_private.is_admin() then return new; end if;', $guard$
 if tg_table_name='portal_admins' and tg_op='INSERT' then
   if new.user_id=auth.uid() and exists(select 1 from auth.users u join portal_private.pending_admins p on lower(u.email)=p.email where u.id=auth.uid() and u.email_confirmed_at is not null) then return new; end if;
 end if;
 if tg_table_name in ('members','directors') and tg_op='UPDATE' then
   if old.auth_user_id is null and new.auth_user_id=auth.uid()
   and (to_jsonb(old)-'auth_user_id'-'updated_at')=(to_jsonb(new)-'auth_user_id'-'updated_at')
   and exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
     and lower(u.email)=lower(coalesce(to_jsonb(old)->>'uf_email',to_jsonb(old)->>'email'))) then return new; end if;
 end if;
 if portal_private.is_admin() then return new; end if;
$guard$);
 execute definition;
end $$;

create function portal_private.initialize_identity() returns jsonb language plpgsql security definer set search_path='' as $$
declare verified_email text; begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if verified_email is not null then
   if exists(select 1 from portal_private.pending_admins where email=verified_email) then
     insert into public.portal_admins(user_id) values(auth.uid()) on conflict(user_id) do nothing;
     delete from portal_private.pending_admins where email=verified_email;
   end if;
   update public.members set auth_user_id=auth.uid() where lower(uf_email)=verified_email and auth_user_id is null;
   update public.directors set auth_user_id=auth.uid() where lower(email)=verified_email and auth_user_id is null;
 end if;
 return portal_private.access_context();
end $$;
create function public.portal_initialize() returns jsonb language sql security invoker set search_path='' as $$ select portal_private.initialize_identity(); $$;
revoke all on function portal_private.initialize_identity(),public.portal_initialize() from public,anon;
grant execute on function portal_private.initialize_identity(),public.portal_initialize() to authenticated;

-- Generate meeting requirement rows when roster members or assignments become active.
create function portal_private.seed_one_on_ones() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='members' then
   insert into public.one_on_ones(member_id,director_id,director_assignment_id)
   select new.id,a.director_id,a.id from public.director_assignments a join public.directors d on d.id=a.director_id
   where a.cohort_id=new.cohort_id and a.active and d.active and new.program_status='active'
   on conflict(member_id,director_id) do nothing;
 else
   insert into public.one_on_ones(member_id,director_id,director_assignment_id)
   select m.id,new.director_id,new.id from public.members m where m.cohort_id=new.cohort_id and m.program_status='active' and new.active
   on conflict(member_id,director_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function portal_private.seed_one_on_ones() from public,anon,authenticated;
create trigger portal_seed after insert or update of program_status on public.members for each row execute function portal_private.seed_one_on_ones();
create trigger portal_seed after insert or update of active on public.director_assignments for each row execute function portal_private.seed_one_on_ones();

-- Expose only the privacy-filtered directory through a checked RPC, not an owner-rights view.
revoke all on public.alumni_directory from anon,authenticated;
create function portal_private.directory() returns setof public.alumni_directory language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not (portal_private.member_cohort(null) or public.is_current_director() or portal_private.is_admin()) then raise exception 'Portal access required'; end if;
 return query select * from public.alumni_directory;
end $$;
create function public.portal_alumni() returns setof public.alumni_directory language sql security invoker set search_path='' as $$ select * from portal_private.directory(); $$;
revoke all on function portal_private.directory(),public.portal_alumni() from public,anon;
grant execute on function portal_private.directory(),public.portal_alumni() to authenticated;
alter function public.update_updated_at_column() set search_path='';
do $$ declare r record; begin
 for r in select p.oid::regprocedure signature,p.prorettype='trigger'::regtype is_trigger from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef loop
   execute format('revoke execute on function %s from public,anon',r.signature);
   if r.is_trigger then execute format('revoke execute on function %s from authenticated',r.signature); end if;
 end loop;
end $$;
-- Obsolete alternate archive/directory APIs are no longer callable by portal clients.
revoke execute on function public.archive_cohort(uuid),public.restore_cohort(uuid),public.get_alumni_directory() from authenticated;
notify pgrst,'reload schema';
