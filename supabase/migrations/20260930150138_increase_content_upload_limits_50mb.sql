do $migration$
declare
  v_updated integer;
begin
  update storage.buckets
  set file_size_limit = 52428800
  where id in ('trailblazers-resources', 'portal-documents');

  get diagnostics v_updated = row_count;
  if v_updated <> 2 then
    raise exception 'Expected both content upload buckets to exist; updated % bucket(s).', v_updated;
  end if;
end;
$migration$;
