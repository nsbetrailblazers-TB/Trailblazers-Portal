alter table public.announcements
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_content_type text,
  add column if not exists attachment_size bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'announcements_attachment_content_type_check'
      and conrelid = 'public.announcements'::regclass
  ) then
    alter table public.announcements
      add constraint announcements_attachment_content_type_check
      check (attachment_content_type is null or attachment_content_type in ('application/pdf','image/jpeg','image/png','image/webp'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'announcements_attachment_size_check'
      and conrelid = 'public.announcements'::regclass
  ) then
    alter table public.announcements
      add constraint announcements_attachment_size_check
      check (attachment_size is null or attachment_size between 1 and 52428800);
  end if;
end;
$$;

update storage.buckets
set public = true, file_size_limit = 52428800
where id = 'trailblazers-resources';

drop policy if exists "content managers upload announcement flyers" on storage.objects;
create policy "content managers upload announcement flyers"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'trailblazers-resources'
  and split_part(storage.objects.name, '/', 2) = 'announcement-flyers'
  and (
    (split_part(storage.objects.name, '/', 1) = 'global' and portal_private.is_admin())
    or exists (
      select 1 from public.cohorts c
      where c.id::text = split_part(storage.objects.name, '/', 1)
        and portal_private.can_manage(c.id, 'content')
    )
  )
);

drop policy if exists "content managers remove announcement flyers" on storage.objects;
create policy "content managers remove announcement flyers"
on storage.objects for delete to authenticated
using (
  bucket_id = 'trailblazers-resources'
  and split_part(storage.objects.name, '/', 2) = 'announcement-flyers'
  and (
    (split_part(storage.objects.name, '/', 1) = 'global' and portal_private.is_admin())
    or exists (
      select 1 from public.cohorts c
      where c.id::text = split_part(storage.objects.name, '/', 1)
        and portal_private.can_manage(c.id, 'content')
    )
  )
);

create or replace function public.portal_set_announcement_attachment(
  p_announcement_id uuid,
  p_path text,
  p_name text,
  p_content_type text,
  p_size bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target public.announcements;
  expected_prefix text;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;

  select * into target
  from public.announcements a
  where a.id = p_announcement_id
  for update;

  if not found then
    raise exception 'Announcement not found.';
  end if;

  if not portal_private.can_manage(target.cohort_id, 'content') then
    raise exception 'Content access required.' using errcode = '42501';
  end if;

  if p_path is null then
    update public.announcements
    set attachment_path = null,
        attachment_name = null,
        attachment_content_type = null,
        attachment_size = null,
        updated_at = now()
    where id = p_announcement_id;
    return;
  end if;

  if p_content_type not in ('application/pdf','image/jpeg','image/png','image/webp')
     or p_size is null or p_size < 1 or p_size > 52428800
     or nullif(trim(p_name), '') is null or length(p_name) > 255 then
    raise exception 'Use a PDF, JPG, PNG, or WebP flyer no larger than 50 MB.';
  end if;

  if target.cohort_id is null then
    if not portal_private.is_admin()
       or p_path !~ '^global/announcement-flyers/[A-Za-z0-9._-]+$' then
      raise exception 'Invalid flyer path for this announcement.' using errcode = '42501';
    end if;
  else
    expected_prefix := target.cohort_id::text || '/announcement-flyers/';
    if left(p_path, length(expected_prefix)) <> expected_prefix
       or substring(p_path from length(expected_prefix) + 1) !~ '^[A-Za-z0-9._-]+$' then
      raise exception 'Invalid flyer path for this cohort.' using errcode = '42501';
    end if;
  end if;

  update public.announcements
  set attachment_path = p_path,
      attachment_name = p_name,
      attachment_content_type = p_content_type,
      attachment_size = p_size,
      updated_at = now()
  where id = p_announcement_id;
end;
$function$;

revoke all on function public.portal_set_announcement_attachment(uuid,text,text,text,bigint) from public, anon;
grant execute on function public.portal_set_announcement_attachment(uuid,text,text,text,bigint) to authenticated;

notify pgrst, 'reload schema';
