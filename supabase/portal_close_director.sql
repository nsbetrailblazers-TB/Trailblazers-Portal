-- Close the director role while preserving history and any other roles.
create or replace function portal_private.close_director(director_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not portal_private.is_admin() then raise exception 'Administrator access required'; end if;
 perform 1 from public.directors where id=director_id for update;
 if not found then raise exception 'Director not found'; end if;
 update public.directors set active=false where id=director_id;
 update public.director_assignments a set active=false where a.director_id=close_director.director_id and a.active;
end $$;
create or replace function public.portal_close_director(director_id uuid)
returns void language sql security invoker set search_path='' as $$ select portal_private.close_director(director_id); $$;
revoke all on function portal_private.close_director(uuid),public.portal_close_director(uuid) from public,anon;
grant execute on function portal_private.close_director(uuid),public.portal_close_director(uuid) to authenticated;
