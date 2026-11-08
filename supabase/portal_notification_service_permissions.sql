-- Server-only access required by send-notification-email.
grant select on public.member_notifications, public.member_notification_preferences to service_role;
grant update (email_status) on public.member_notifications to service_role;
