-- Storage for director-uploaded member resources. Files are served through the
-- public bucket URL recorded on the existing resources table.

insert into storage.buckets (id, name, public, file_size_limit)
values ('trailblazers-resources', 'trailblazers-resources', true, 15728640)
on conflict (id) do update
set public = true,
    file_size_limit = 15728640;

drop policy if exists "directors upload cohort resource files" on storage.objects;
create policy "directors upload cohort resource files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'trailblazers-resources'
  and exists (
    select 1
    from public.directors d
    join public.director_assignments da on da.director_id = d.id
    where d.auth_user_id = auth.uid()
      and d.active = true
      and da.active = true
      and storage.objects.name like da.cohort_id::text || '/%'
  )
);

drop policy if exists "directors remove cohort resource files" on storage.objects;
create policy "directors remove cohort resource files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'trailblazers-resources'
  and exists (
    select 1
    from public.directors d
    join public.director_assignments da on da.director_id = d.id
    where d.auth_user_id = auth.uid()
      and d.active = true
      and da.active = true
      and storage.objects.name like da.cohort_id::text || '/%'
  )
);
