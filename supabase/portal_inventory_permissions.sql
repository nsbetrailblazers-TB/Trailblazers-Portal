grant select on public.member_notification_preferences to authenticated;
grant select on public.member_notifications to authenticated;
revoke all on public.hub_sections,public.director_notifications from anon,authenticated;
grant select on public.hub_sections,public.director_notifications to authenticated;
grant all on public.hub_sections,public.director_notifications to service_role;
-- A cohort care grant is explicit, never part of the default director assignment.
-- Preference selection remains restricted by the pre-existing owner policy.
notify pgrst,'reload schema';
