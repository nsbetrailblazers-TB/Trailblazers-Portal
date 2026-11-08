insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portal-documents','portal-documents',false,52428800,array['application/pdf']) on conflict(id) do nothing;
create policy portal_documents_upload on storage.objects for insert to authenticated with check(bucket_id='portal-documents' and portal_private.is_admin());
create policy portal_documents_read on storage.objects for select to authenticated using(bucket_id='portal-documents' and (portal_private.is_admin() or portal_private.member_cohort(null) or public.is_current_director()));
create policy portal_documents_remove on storage.objects for delete to authenticated using(bucket_id='portal-documents' and portal_private.is_admin());

create or replace function portal_private.points_document(operation text,path text default null)
returns text language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not (portal_private.is_admin() or portal_private.member_cohort(null) or public.is_current_director()) then raise exception 'Portal access required'; end if;
 if operation='save' then
  if not portal_private.is_admin() then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from storage.objects where bucket_id='portal-documents' and name=path and metadata->>'mimetype'='application/pdf') then raise exception 'Upload a PDF first'; end if;
  insert into public.portal_settings(setting_key,setting_value) values('points_rules_path',jsonb_build_object('value',path)) on conflict(setting_key) do update set setting_value=excluded.setting_value;
 elsif operation<>'read' then raise exception 'Unknown document operation'; end if;
 return (select setting_value->>'value' from public.portal_settings where setting_key='points_rules_path');
end $$;
create or replace function public.portal_points_document(operation text,path text default null)
returns text language sql security invoker set search_path='' as $$ select portal_private.points_document(operation,path); $$;
revoke all on function portal_private.points_document(text,text),public.portal_points_document(text,text) from public,anon;
grant execute on function portal_private.points_document(text,text),public.portal_points_document(text,text) to authenticated;

-- One notification per eligible member, and never expose future announcements.
drop trigger if exists announcements_notify_members on public.announcements;
drop function if exists public.notify_announcement_members();
create or replace function portal_private.notify_announcement_members() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.active and new.audience='members' and new.publish_at<=now() and (new.expires_at is null or new.expires_at>now()) then
  insert into public.member_notifications(member_id,notification_type,title,body,target_page,dedupe_key)
  select m.id,'announcement',new.title,new.body,'home','announcement:'||new.id||':'||m.id
  from public.members m where m.program_status='active' and (new.cohort_id is null or m.cohort_id=new.cohort_id)
  on conflict(dedupe_key) do nothing;
 end if;
 return new;
end $$;
revoke all on function portal_private.notify_announcement_members() from public,anon,authenticated;
create trigger announcements_notify_members after insert or update on public.announcements for each row execute function portal_private.notify_announcement_members();
