-- Server-side invitation handler verifies the caller with Auth and checks
-- active administrator membership before accessing a roster identity.
grant usage on schema public to service_role;
grant select on public.portal_admins, public.members, public.directors to service_role;
grant insert on public.activity_log to service_role;
