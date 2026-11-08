-- Additional projections and validation for the full inventory.
create function portal_private.alumni_extended() returns table (
 id uuid,first_name text,last_name text,preferred_name text,graduation_year integer,major text,
 current_company text,current_title text,linkedin_url text,contact_email text,contact_visible boolean,
 cohort_name text,class_number integer,minor text,organizations text,career_interests text
) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not (portal_private.member_cohort(null) or public.is_current_director() or portal_private.is_admin()) then raise exception 'Portal access required'; end if;
 if exists(select 1 from public.portal_settings where setting_key='alumni_directory_enabled' and setting_value->>'value'='false') then return; end if;
 return query select a.id,a.first_name,a.last_name,a.preferred_name,a.graduation_year,a.major,a.current_company,a.current_title,a.linkedin_url,a.contact_email,a.contact_visible,a.cohort_name,a.class_number,null::text,null::text,null::text from public.alumni_directory a
 union all select m.id,m.first_name,m.last_name,m.preferred_name,m.graduation_year,m.major,m.alumni_company,m.alumni_role,
 case when m.show_linkedin then m.linkedin_url else null end,case when m.show_email then m.uf_email else null end,m.show_email,c.name,c.class_number,m.minor,m.organizations,m.career_interests
 from public.members m join public.cohorts c on c.id=m.cohort_id where m.program_status='archived' and m.show_in_alumni_directory;
end $$;
create function public.portal_alumni_extended() returns table (
 id uuid,first_name text,last_name text,preferred_name text,graduation_year integer,major text,
 current_company text,current_title text,linkedin_url text,contact_email text,contact_visible boolean,
 cohort_name text,class_number integer,minor text,organizations text,career_interests text
) language sql set search_path='' as $$select * from portal_private.alumni_extended()$$;
revoke all on function portal_private.alumni_extended(),public.portal_alumni_extended() from public,anon;
grant execute on function portal_private.alumni_extended(),public.portal_alumni_extended() to authenticated;

do $$declare d text;begin
 select pg_get_functiondef('portal_private.workspace(text,uuid,jsonb)'::regprocedure) into d;
 d:=replace(d,'coalesce(result,''{}'')||(select to_jsonb(m) from public.members m where id=rid)','(select to_jsonb(m) from public.members m where id=rid)||coalesce(result,''{}'')');
 execute d;
 select pg_get_functiondef('portal_private.mutate(text,uuid,jsonb)'::regprocedure) into d;
 d:=replace(d,'coalesce((payload->>''point_requirement'')::integer,30)','coalesce((payload->>''point_requirement'')::integer,(select (setting_value->>''value'')::integer from public.portal_settings where setting_key=''point_requirement''),30)');
 d:=replace(d,' elsif kind=''import'' then',$body$
   perform portal_private.workspace('profile',rid,(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(payload) where key in ('nsbe_id','personal_email','phone','preferred_contact_method','major','minor','college','graduation_year','academic_interests','career_interests','research_interests','organizations','leadership_roles','hobbies','skills','birthday_month','birthday_day','linkedin_url','pronouns','favorite_snack','favorite_candy','favorite_color','fun_fact','professional_interests')));
   if payload ? 'dietary_preference' or payload ? 'food_allergies' or payload ? 'dietary_restrictions' then perform portal_private.workspace('care',rid,payload); end if;
 elsif kind='import' then$body$);
 d:=replace(d,' elsif kind=''settings'' then',$body$
 elsif kind='settings' then
   if payload->>'setting_key'='point_requirement' and coalesce((payload->'setting_value'->>'value')::integer,0) not between 1 and 1000 then raise exception 'Point requirement must be 1 to 1000'; end if;
   if payload->>'setting_key'='portal_name' and coalesce(length(trim(payload->'setting_value'->>'value')),0) not between 1 and 100 then raise exception 'Portal name must be 1 to 100 characters'; end if;
   if payload->>'setting_key'='alumni_directory_enabled' and jsonb_typeof(payload->'setting_value'->'value')<>'boolean' then raise exception 'Alumni setting must be true or false'; end if;
   if payload->>'setting_key'='point_deadline' and payload->'setting_value'->>'value' is not null then perform (payload->'setting_value'->>'value')::date; end if;
 $body$);
 d:=replace(d,' return rid;', $body$
 if kind='resource' then update public.resources set resource_type=coalesce(payload->>'resource_type','external_link'),drive_file_url=case when payload->>'resource_type'='drive_file' then payload->>'external_url' else null end where id=rid; end if;
 return rid;$body$);
 execute d;
 -- Honor directory visibility even through the legacy RPC.
 select pg_get_functiondef('portal_private.directory()'::regprocedure) into d;
 d:=replace(d,' return query select', ' if exists(select 1 from public.portal_settings where setting_key=''alumni_directory_enabled'' and setting_value->>''value''=''false'') then return; end if; return query select');
 execute d;
end $$;

-- Uploaded profile photos are private and follow the member's cohort visibility.
create policy profile_photo_read on storage.objects for select to authenticated using
 (bucket_id='trailblazers-private' and exists(select 1 from public.members m where m.photo_path=name and portal_private.member_access(m.id)));
drop policy private_cleanup on storage.objects;
create policy private_cleanup on storage.objects for delete to authenticated using
 (bucket_id='trailblazers-private' and (storage.foldername(name))[1]=auth.uid()::text
 and not exists(select 1 from public.resume_submissions where file_path=name)
 and not exists(select 1 from public.point_submissions where evidence_path=name)
 and not exists(select 1 from public.members where photo_path=name));
notify pgrst,'reload schema';
