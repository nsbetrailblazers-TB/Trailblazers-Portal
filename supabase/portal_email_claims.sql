alter table public.member_notifications drop constraint member_notifications_email_status_check;
alter table public.member_notifications add constraint member_notifications_email_status_check check(email_status in ('queued','sending','sent','skipped','failed'));
alter table public.director_notifications drop constraint director_notifications_email_status_check;
alter table public.director_notifications add constraint director_notifications_email_status_check check(email_status in ('queued','sending','sent','skipped','failed'));
