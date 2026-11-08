alter table public.point_submissions add column if not exists reviewed_by_user_id uuid references auth.users(id), add column if not exists reviewer_name text;
update public.point_submissions p set reviewed_by_user_id=d.auth_user_id,reviewer_name=d.first_name||' '||d.last_name from public.directors d where p.reviewed_by=d.id and p.reviewer_name is null;
create function portal_private.review_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reviewed_at is distinct from old.reviewed_at and auth.uid() is not null then
  new.reviewed_by_user_id:=auth.uid();
  select first_name||' '||last_name into new.reviewer_name from public.directors where auth_user_id=auth.uid();
  new.reviewer_name:=coalesce(new.reviewer_name,'Portal administrator');
 end if;
 return new;
end $$;
create trigger portal_review_identity before update on public.point_submissions for each row execute function portal_private.review_identity();
revoke all on function portal_private.review_identity() from public,anon,authenticated;
notify pgrst,'reload schema';
