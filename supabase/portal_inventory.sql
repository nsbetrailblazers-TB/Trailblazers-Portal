-- Inventory expansion: authenticated RPCs; sensitive information is isolated.
alter table public.members add column if not exists pronouns text,
 add column if not exists photo_path text,
 add column if not exists favorite_snack text,
 add column if not exists favorite_candy text,
 add column if not exists favorite_color text,
 add column if not exists fun_fact text,
 add column if not exists professional_interests text;
create table portal_private.member_care (
 member_id uuid primary key references public.members(id), dietary_preference text,
 food_allergies text, dietary_restrictions text, accommodations text, updated_at timestamptz default now()
);
alter table portal_private.member_care enable row level security;
insert into portal_private.member_care(member_id,dietary_preference,food_allergies,dietary_restrictions)
 select id,dietary_preference,food_allergies,dietary_restrictions from public.members;
update public.members set dietary_preference=null,food_allergies=null,dietary_restrictions=null;
-- Old clients cannot repopulate sensitive columns that ordinary roster readers can see.
create function portal_private.protect_care() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.dietary_preference is not null or new.food_allergies is not null or new.dietary_restrictions is not null then
  raise exception 'Use the private dietary and accessibility form';
 end if;
 return new;
end $$;
create trigger portal_care before insert or update on public.members for each row execute function portal_private.protect_care();
revoke all on function portal_private.protect_care() from public,anon,authenticated;

create table public.hub_sections (
 id uuid primary key default gen_random_uuid(), cohort_id uuid references public.cohorts(id),
 title text not null check(length(trim(title))>0), body text not null default '', link_url text,
 display_order integer not null default 0, active boolean not null default true,
 updated_at timestamptz not null default now()
);
alter table public.hub_sections enable row level security;
grant select on public.hub_sections to authenticated;
revoke all on public.hub_sections from anon;
create policy hub_read on public.hub_sections for select to authenticated using
 (portal_private.can_manage(cohort_id,'content') or (active and portal_private.member_cohort(cohort_id)));
create trigger portal_audit after insert or update on public.hub_sections for each row execute function portal_private.audit_change();
create trigger portal_care_audit after insert or update on portal_private.member_care for each row execute function portal_private.audit_change();

create function portal_private.workspace(operation text, record_id uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mid uuid; cid uuid; rid uuid:=record_id; item jsonb; k text; cols text; row_value public.members; result jsonb;
 allowed_fields text[]:=array['first_name','last_name','preferred_name','nsbe_id','uf_email','personal_email','phone','preferred_contact_method','major','minor','college','graduation_year','academic_interests','career_interests','research_interests','organizations','leadership_roles','hobbies','skills','birthday_month','birthday_day','linkedin_url','show_in_alumni_directory','show_email','show_linkedin','alumni_role','alumni_company','pronouns','photo_path','favorite_snack','favorite_candy','favorite_color','fun_fact','professional_interests'];
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if not (portal_private.is_admin() or portal_private.member_cohort(null) or public.is_current_director()) then raise exception 'Portal access required'; end if;
 select id into mid from public.members where auth_user_id=auth.uid();
 if operation='config' then
  return coalesce((select jsonb_object_agg(setting_key,setting_value->'value') from public.portal_settings where setting_key in ('portal_name','point_requirement','alumni_directory_enabled','point_deadline')), '{}'::jsonb);
 elsif operation in ('profile','profile_read','care_read','care') then
  rid:=coalesce(rid,mid);
  select cohort_id into cid from public.members where id=rid;
  if cid is null then raise exception 'Member not found'; end if;
  if operation in ('profile','profile_read') and not (portal_private.owns_member(rid) or portal_private.is_admin()) then raise exception 'Profile access required'; end if;
  if operation in ('care','care_read') and not (portal_private.owns_member(rid) or portal_private.can_manage(cid,'care')) then raise exception 'Dietary/accessibility permission required'; end if;
  if operation in ('profile_read','care_read') then
   select to_jsonb(c)-'member_id' into result from portal_private.member_care c where member_id=rid;
   if operation='profile_read' then result:=coalesce(result,'{}')||(select to_jsonb(m) from public.members m where id=rid); end if;
   return coalesce(result,'{}');
  elsif operation='care' then
   insert into portal_private.member_care(member_id,dietary_preference,food_allergies,dietary_restrictions,accommodations)
   values(rid,payload->>'dietary_preference',payload->>'food_allergies',payload->>'dietary_restrictions',payload->>'accommodations')
   on conflict(member_id) do update set dietary_preference=excluded.dietary_preference,food_allergies=excluded.food_allergies,dietary_restrictions=excluded.dietary_restrictions,accommodations=excluded.accommodations,updated_at=now();
  else
   if exists(select 1 from jsonb_object_keys(payload) x where not x=any(allowed_fields)) then raise exception 'Unsupported profile field'; end if;
   select * into row_value from public.members where id=rid for update;
   row_value:=jsonb_populate_record(row_value,payload);
   if nullif(trim(row_value.first_name),'') is null or nullif(trim(row_value.last_name),'') is null or row_value.uf_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Name and valid email required'; end if;
   if (row_value.birthday_month is null) <> (row_value.birthday_day is null) then raise exception 'Provide birthday month and day together'; end if;
   if row_value.birthday_month is not null then perform make_date(2000,row_value.birthday_month,row_value.birthday_day); end if;
   if row_value.linkedin_url is not null and row_value.linkedin_url !~ '^https://' then raise exception 'Use an HTTPS LinkedIn URL'; end if;
   if row_value.photo_path is not null and not exists(select 1 from storage.objects where bucket_id='trailblazers-private' and name=row_value.photo_path and split_part(name,'/',1)=(select auth_user_id::text from public.members where id=rid) and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')) then raise exception 'Upload a profile picture first'; end if;
   foreach k in array allowed_fields loop
    if payload ? k then cols:=concat_ws(',',cols,format('%I = ($1).%I',k,k)); end if;
   end loop;
   if cols is not null then execute 'update public.members set '||cols||' where id=$2' using row_value,rid; end if;
  end if;
 elsif operation='preferences' then
  if mid is null then raise exception 'Member account required'; end if;
  insert into public.member_notification_preferences(member_id,email_enabled,announcement_email_enabled,resource_email_enabled,meeting_email_enabled)
  values(mid,coalesce((payload->>'email_enabled')::boolean,true),coalesce((payload->>'announcement_email_enabled')::boolean,true),coalesce((payload->>'resource_email_enabled')::boolean,true),coalesce((payload->>'meeting_email_enabled')::boolean,true))
  on conflict(member_id) do update set email_enabled=excluded.email_enabled,announcement_email_enabled=excluded.announcement_email_enabled,resource_email_enabled=excluded.resource_email_enabled,meeting_email_enabled=excluded.meeting_email_enabled,updated_at=now();
 elsif operation='hub' then
  cid:=(payload->>'cohort_id')::uuid;
  if rid is not null then select cohort_id into cid from public.hub_sections where id=rid; if not found then raise exception 'Section missing'; end if; end if;
  if not portal_private.can_manage(cid,'content') then raise exception 'Content permission required'; end if;
  if nullif(payload->>'link_url','') is not null and payload->>'link_url' !~ '^https?://' then raise exception 'Use an HTTP or HTTPS link'; end if;
  insert into public.hub_sections(id,cohort_id,title,body,link_url,display_order,active)
  values(coalesce(rid,gen_random_uuid()),cid,payload->>'title',coalesce(payload->>'body',''),payload->>'link_url',coalesce((payload->>'display_order')::integer,0),coalesce((payload->>'active')::boolean,true))
  on conflict(id) do update set title=excluded.title,body=excluded.body,link_url=excluded.link_url,display_order=excluded.display_order,active=excluded.active,updated_at=now() returning id into rid;
 elsif operation='rule' then
  if not portal_private.is_admin() then raise exception 'Administrator access required for global point rules'; end if;
  if (payload->>'default_points')::integer not between 0 and 1000 then raise exception 'Points must be between 0 and 1000'; end if;
  insert into public.point_rules(id,name,description,default_points,category,active)
  values(coalesce(rid,gen_random_uuid()),nullif(trim(payload->>'name'),''),payload->>'description',(payload->>'default_points')::integer,payload->>'category',coalesce((payload->>'active')::boolean,true))
  on conflict(id) do update set name=excluded.name,description=excluded.description,default_points=excluded.default_points,category=excluded.category,active=excluded.active,updated_at=now() returning id into rid;
 elsif operation='template' then
  if not portal_private.is_admin() then raise exception 'Administrator access required'; end if;
  insert into public.email_templates(template_key,name,subject,body,active)
  values(payload->>'template_key',payload->>'name',payload->>'subject',payload->>'body',coalesce((payload->>'active')::boolean,true))
  on conflict(template_key) do update set name=excluded.name,subject=excluded.subject,body=excluded.body,active=excluded.active,updated_at=now() returning id into rid;
 elsif operation='director_import' then
  if not portal_private.is_admin() then raise exception 'Administrator access required'; end if;
  if jsonb_typeof(payload->'rows')<>'array' or jsonb_array_length(payload->'rows') not between 1 and 500 then raise exception 'Import 1 to 500 directors'; end if;
  for item in select value from jsonb_array_elements(payload->'rows') loop
   rid:=portal_private.mutate('director',null,item);
   perform portal_private.mutate('assignment',null,jsonb_build_object('director_id',rid,'cohort_id',item->>'cohort_id','title',coalesce(item->>'title','Director'),'capabilities',jsonb_build_array('points','strikes','resumes','content','events','meetings')));
  end loop;
 else raise exception 'Unknown operation'; end if;
 return jsonb_build_object('id',rid);
end $$;
create function public.portal_workspace(operation text,record_id uuid default null,payload jsonb default '{}') returns jsonb
 language sql set search_path='' as $$select portal_private.workspace(operation,record_id,payload)$$;
revoke all on function portal_private.workspace(text,uuid,jsonb),public.portal_workspace(text,uuid,jsonb) from public,anon;
grant execute on function portal_private.workspace(text,uuid,jsonb),public.portal_workspace(text,uuid,jsonb) to authenticated;

-- Enforce in-person meetings on every scheduling route, retaining historical method values.
create function portal_private.in_person() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' or new.scheduled_date is distinct from old.scheduled_date or new.meeting_method is distinct from old.meeting_method then new.meeting_method:='in_person'; end if;
 return new;
end $$;
create trigger portal_in_person before insert or update on public.one_on_ones for each row execute function portal_private.in_person();
revoke all on function portal_private.in_person() from public,anon,authenticated;
notify pgrst,'reload schema';
