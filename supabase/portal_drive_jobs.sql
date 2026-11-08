create table portal_private.drive_jobs(job_key text primary key,expires_at timestamptz not null);
alter table portal_private.drive_jobs enable row level security;
create function portal_private.claim_drive(job_key text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 insert into portal_private.drive_jobs values(job_key,now()+interval '5 minutes') on conflict on constraint drive_jobs_pkey do update set expires_at=excluded.expires_at where portal_private.drive_jobs.expires_at<now();
 return found;
end $$;
create function public.portal_claim_drive_job(job_key text) returns boolean language sql set search_path='' as $$select portal_private.claim_drive(job_key)$$;
create function portal_private.release_drive(job_key text) returns void language sql security definer set search_path='' as $$delete from portal_private.drive_jobs where drive_jobs.job_key=$1$$;
create function public.portal_release_drive_job(job_key text) returns void language sql set search_path='' as $$select portal_private.release_drive(job_key)$$;
revoke all on function portal_private.claim_drive(text),portal_private.release_drive(text),public.portal_claim_drive_job(text),public.portal_release_drive_job(text) from public,anon,authenticated;
grant usage on schema portal_private to service_role;
grant execute on function portal_private.claim_drive(text),portal_private.release_drive(text),public.portal_claim_drive_job(text),public.portal_release_drive_job(text) to service_role;
notify pgrst,'reload schema';
