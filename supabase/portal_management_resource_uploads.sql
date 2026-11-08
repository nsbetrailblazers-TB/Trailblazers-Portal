begin;
create policy "content managers upload resource files" on storage.objects
for insert to authenticated with check (
 bucket_id='trailblazers-resources' and split_part(name,'/',2)='resources'
 and ((split_part(name,'/',1)='global' and portal_private.is_admin())
   or exists(select 1 from public.cohorts c where c.id::text=split_part(objects.name,'/',1) and portal_private.can_manage(c.id,'content')))
);
create policy "content managers remove resource files" on storage.objects
for delete to authenticated using (
 bucket_id='trailblazers-resources' and split_part(name,'/',2)='resources'
 and ((split_part(name,'/',1)='global' and portal_private.is_admin())
   or exists(select 1 from public.cohorts c where c.id::text=split_part(objects.name,'/',1) and portal_private.can_manage(c.id,'content')))
);
commit;
