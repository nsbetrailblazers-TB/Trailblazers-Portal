do $$declare d text;begin
 select pg_get_functiondef('portal_private.workspace(text,uuid,jsonb)'::regprocedure) into d;
 d:=replace(d,' if operation=''config'' then',$body$
 if operation='member_save' then
  if not portal_private.is_admin() then raise exception 'Administrator access required'; end if;
  rid:=portal_private.mutate('member',rid,payload);
  perform portal_private.workspace('profile',rid,(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(payload) where key=any(allowed_fields)));
  if payload ? 'accommodations' then perform portal_private.workspace('care',rid,payload); end if;
  return jsonb_build_object('id',rid);
 elsif operation='config' then$body$);
 execute d;
end $$;

-- Enforce picture evidence even through older submission entry points.
create function portal_private.evidence_required() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and not exists(select 1 from storage.objects where bucket_id='trailblazers-private' and name=new.evidence_path and split_part(name,'/',1)=auth.uid()::text and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')) then raise exception 'Upload a JPG, PNG, or WebP picture with your submission'; end if;
 return new;
end $$;
create trigger portal_evidence before insert on public.point_submissions for each row execute function portal_private.evidence_required();
revoke all on function portal_private.evidence_required() from public,anon,authenticated;

-- Queue receipt and review notifications rather than exposing privileged fields to clients.
-- The scheduler is installed but remains disabled until the admin enables it.
notify pgrst,'reload schema';
