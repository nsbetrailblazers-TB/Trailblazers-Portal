do $$ declare item text; begin
 foreach item in array array['announcements','resources'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=item) then
   execute format('alter publication supabase_realtime add table public.%I',item);
  end if;
 end loop;
end $$;
