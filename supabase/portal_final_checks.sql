-- Staff notes remain available through the administrator audit history only.
revoke select on public.strikes from authenticated;
grant select(id,member_id,reason,issued_by,issued_at,status,resolved_at,resolution_note) on public.strikes to authenticated;

-- Clients receive updates only for rows authorized by their SELECT policies.
do $$ declare t text; begin
 foreach t in array array['point_submissions','one_on_ones','strikes','resume_submissions','member_notifications'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
     execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
 end loop;
end $$;

-- A resume must be a PDF according to the upload's stored MIME metadata as well.
do $$ declare d text; begin
 select pg_get_functiondef('portal_private.submit_file(text,text,text,jsonb)'::regprocedure) into d;
 d:=replace(d,'if path !~* ''\.pdf$'' then', 'if path !~* ''\.pdf$'' or not exists(select 1 from storage.objects where bucket_id=''trailblazers-private'' and name=path and metadata->>''mimetype''=''application/pdf'') then');
 execute d;
end $$;
notify pgrst,'reload schema';
