-- Allow every linked portal identity (including inactive members and directors)
-- to use shared resources, NSBE Hub links, alumni, and the points guide.
-- Cohort-specific member data and management permissions keep their existing rules.

create or replace function portal_private.has_portal_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.members m where m.auth_user_id = auth.uid())
    or exists (select 1 from public.directors d where d.auth_user_id = auth.uid())
    or portal_private.is_admin()
  );
$$;

revoke all on function portal_private.has_portal_account() from public, anon;
grant execute on function portal_private.has_portal_account() to authenticated;

create or replace function public.portal_shared_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select portal_private.has_portal_account();
$$;

revoke all on function public.portal_shared_access() from public, anon;
grant execute on function public.portal_shared_access() to authenticated;

drop policy if exists resources_read on public.resources;
drop policy if exists global_director_resources on public.resources;
create policy resources_read on public.resources
for select to authenticated
using (active and portal_private.has_portal_account());

drop policy if exists hub_read on public.hub_sections;
create policy hub_read on public.hub_sections
for select to authenticated
using (active and portal_private.has_portal_account());

create or replace function portal_private.alumni_extended()
returns table(
  id uuid,
  first_name text,
  last_name text,
  preferred_name text,
  graduation_year integer,
  major text,
  current_company text,
  current_title text,
  linkedin_url text,
  contact_email text,
  contact_visible boolean,
  cohort_name text,
  class_number integer,
  minor text,
  organizations text,
  career_interests text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not portal_private.has_portal_account() then
    raise exception 'Portal access required';
  end if;

  if exists (
    select 1 from public.portal_settings
    where setting_key = 'alumni_directory_enabled'
      and setting_value->>'value' = 'false'
  ) then
    return;
  end if;

  return query
  select a.id,a.first_name,a.last_name,a.preferred_name,a.graduation_year,a.major,
    a.current_company,a.current_title,a.linkedin_url,a.contact_email,a.contact_visible,
    a.cohort_name,a.class_number,null::text,null::text,null::text
  from public.alumni_directory a
  union all
  select m.id,m.first_name,m.last_name,m.preferred_name,m.graduation_year,m.major,
    m.alumni_company,m.alumni_role,
    case when m.show_linkedin then m.linkedin_url else null end,
    case when m.show_email then m.uf_email else null end,
    m.show_email,c.name,c.class_number,m.minor,m.organizations,m.career_interests
  from public.members m
  join public.cohorts c on c.id=m.cohort_id
  where m.program_status='archived' and m.show_in_alumni_directory;
end;
$$;

create or replace function portal_private.shared_points_document_path()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select setting_value->>'value'
  from public.portal_settings
  where setting_key='points_rules_path';
$$;
revoke all on function portal_private.shared_points_document_path() from public, anon;
grant execute on function portal_private.shared_points_document_path() to authenticated;

drop policy if exists portal_documents_read on storage.objects;
create policy portal_documents_read on storage.objects
for select to authenticated
using (
  bucket_id='portal-documents'
  and portal_private.has_portal_account()
  and name=portal_private.shared_points_document_path()
);

create or replace function portal_private.points_document(operation text,path text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not portal_private.has_portal_account() then
    raise exception 'Portal access required';
  end if;

  if operation='save' then
    if not portal_private.is_admin() then
      raise exception 'Administrator access required';
    end if;
    if not exists(
      select 1 from storage.objects
      where bucket_id='portal-documents'
        and name=path
        and metadata->>'mimetype'='application/pdf'
    ) then
      raise exception 'Upload a PDF first';
    end if;
    insert into public.portal_settings(setting_key,setting_value)
    values('points_rules_path',jsonb_build_object('value',path))
    on conflict(setting_key) do update set setting_value=excluded.setting_value;
  elsif operation<>'read' then
    raise exception 'Unknown document operation';
  end if;

  return (
    select setting_value->>'value'
    from public.portal_settings
    where setting_key='points_rules_path'
  );
end;
$$;

revoke all on function portal_private.alumni_extended() from public, anon;
grant execute on function portal_private.alumni_extended() to authenticated;
revoke all on function portal_private.points_document(text,text) from public, anon;
grant execute on function portal_private.points_document(text,text) to authenticated;
