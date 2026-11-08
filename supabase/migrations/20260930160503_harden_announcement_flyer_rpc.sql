create or replace function portal_private.set_announcement_attachment(
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

grant usage on schema portal_private to authenticated;
revoke all on function portal_private.set_announcement_attachment(uuid,text,text,text,bigint) from public, anon;
grant execute on function portal_private.set_announcement_attachment(uuid,text,text,text,bigint) to authenticated;

create or replace function public.portal_set_announcement_attachment(
  p_announcement_id uuid,
  p_path text,
  p_name text,
  p_content_type text,
  p_size bigint
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select portal_private.set_announcement_attachment(p_announcement_id, p_path, p_name, p_content_type, p_size);
$function$;

revoke all on function public.portal_set_announcement_attachment(uuid,text,text,text,bigint) from public, anon;
grant execute on function public.portal_set_announcement_attachment(uuid,text,text,text,bigint) to authenticated;
