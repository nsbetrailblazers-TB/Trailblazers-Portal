# Portal launch checklist — September 27, 2026

## Latest verified progress
- Traced the latest director invitation failure to Supabase Auth SMTP: Gmail returned `535 5.7.8 Username and Password not accepted` for the Auth `/invite` request. The portal's separate Gmail notification sender had already passed a controlled delivery test.
- The invitation path now bypasses that Auth SMTP login. Password-reset emails still use Auth SMTP, so the current 535 error must be cleared in Supabase Authentication → SMTP Settings before recovery is considered ready.
- Updated and deployed `invite-portal-user` (Supabase function version 11) to generate single-use invite/sign-in links and send them through the portal Gmail sender. Updated the Admin success feedback and deployed the production site. No invitation was sent during this repair.
- Live readiness snapshot: Class 4 has 36 active member records (1 account linked) and 9 active assigned directors (0 accounts linked); Class 3 is archived. One active announcement and one upcoming event exist. There are no active resources or Hub sections yet.
- Added 27 active Class 4 point activity defaults from the uploaded points guide (4 required and 23 optional, grouped into 6 categories). Admin can manage them inline under Points; directors still verify semester caps and award decisions against the guide.
- Current settings are Class 4's 10-point requirement, 2026–2027 program year, Fall deadline November 29, 2026, Spring deadline April 25, 2027, alumni directory enabled, and scheduled reminders disabled. The private points-guide path is configured. Reminder generation now selects the Fall or Spring deadline by semester.
- User confirmed invitation delivery (in Spam) and successful new account setup.
- Class 4 now has 36 active member rows (35 imported from the 2026–27 contact sheet plus the existing test member) and 9 active assigned directors.
- Fixed missing service-role access to member notifications and email preferences; verified read and delivery-status update permissions.
- Both INSERT webhooks are enabled, use the correct notification endpoint and POST method, and include the rotated x-webhook-secret header. Gmail SMTP delivery was confirmed with an approved test email received by the recipient. Previous failed test records remain marked failed and were not retried.
- Reminder-generation SQL tests for birthday, meeting, and deadline notifications pass; email preference logic tests pass. Automatic reminders remain disabled until the real roster/content is ready and the owner enables them.
- Imported 35 members from the 2026–27 contact sheet into active Class 4. The existing active test account remains, so Class 4 currently has 36 active member rows.
- Activated and assigned all 9 listed directors to Class 4 with the approved cohort-scoped capabilities; care-information access remains off. No invitations were sent at the user's request.
- Added 30 Class 3 roster members as archived records; one matching Class 3 member was already present and remains inactive. The 25–26 sheet has no email column, so the 30 new historical records have no email set.
- Recorded Zion Tomlin's Class 3 assignment as inactive. The other 7 Class 3 directors are not yet in the portal because their emails are missing from the sheet and the directors table requires an email.
- Points rules PDF is not configured yet.

## Completed in the portal
- Existing 10 director identities and 1 member closed, with records preserved; 1 Admin remains active.
- Director closure is atomic and preserves other roles. Closed directors are hidden by default.
- Class 4: 10 points; fall deadline November 29, 2026, 11:59 PM Eastern. Program year 2026–2027.
- Director points and resume review navigation; admin overview spacing; admin birthday sections removed.
- Admin Points → Upload rules PDF; private shared rules document available from member and director Points.
- The uploaded points guide's 27 activity defaults are available to Class 4 members; admins manage them inline under Points.
- Current and archived roster entry; director assignments default without care access.
- Invitation function explicitly allows the production portal origin and reports backend errors in the UI.
- Announcement notifications reach every eligible member, respect publication time, and do not duplicate.
- Gmail SMTP sender deployed with preference checks, atomic delivery claims, and failure reporting.
- Optional automatic Drive copying remains skipped; point submissions no longer attempt it.

## 1. Confirm account email delivery
Portal notifications and account invitations use the Gmail SMTP secrets configured for Edge Functions. Account invites now use generated Supabase Auth links delivered by the tested portal sender, so they do not rely on Supabase Auth's separate SMTP login. Supabase Auth's own recovery emails still use Auth SMTP settings.

In Supabase → Edge Functions → Secrets, set:
- GMAIL_SMTP_USER: the Gmail sender address.
- GMAIL_SMTP_APP_PASSWORD: its Google app password, entered privately.
- WEBHOOK_SECRET: a long random secret used only for notification webhooks.

In Supabase → Database → Webhooks, create INSERT webhooks for both public.member_notifications and public.director_notifications:
- Method: POST
- URL: https://vldbxkbczkqwclbbifkb.supabase.co/functions/v1/send-notification-email
- Header: x-webhook-secret with the same WEBHOOK_SECRET
- Header: Content-Type: application/json

Do not use Gmail's normal password or put secrets in chat/source code. The Edge Function uses the Gmail app password in Supabase Function secrets; it does not read the separate Auth SMTP password.
The sender uses TLS on Gmail port 465. It requires no Resend domain.
Review old queued notifications before any manual replay. INSERT webhooks do not automatically replay old records.
Statuses: queued, sending, sent, skipped, failed. A sending or failed record must be reviewed before retry; SMTP cannot guarantee exactly-once delivery after a network interruption.
Scheduled reminders remain disabled until real roster/content is ready and an administrator enables them.
Birthday/meeting/deadline queue generation and preferences pass tests; Gmail notification delivery was confirmed by a controlled inbox test.

## 2. Enter the real roster
- Admin → Cohorts: review Class 4; add any other cohorts needed.
- Admin → Members: add active Class 4 members; use Archived status for historical members in old cohorts.
- CSV/XLSX roster import supports active cohorts. Historical members can be entered individually.
- Admin → Directors: use Show closed accounts to edit/reactivate an existing identity, or add a new director.
- Admin → Assignments: assign directors to Class 4 and choose capabilities. Grant care only to named authorized directors.
- Meeting requirements follow active director assignments.
- Admin → Directors or Members → Invite / connect: send invitations after activating the identity. The latest function has not yet been tested against a real recipient; test with one account and confirm receipt before inviting a full roster.
- An existing verified login connects by its matching email. Keep the Admin account active.
Roster names were imported from the supplied contact sheets; no new invitations were sent during the September 27 repair.

## 3. Provide real content
The points guide is configured in the private document store. Both semester deadlines from the guide are configured. Add the remaining handbook/resources, meeting slides under the Meeting Slides category, real announcements, and event dates. Current active resource count and Hub-section count are both zero. Review Admin → Email templates and Settings. Alumni features are currently enabled; change this in Settings if desired.

## 4. Final acceptance with real accounts
The database security and workflow tests passed using rolled-back synthetic fixtures. Browser navigation/review tests used isolated fixtures.
Remaining live checks: a new invitation accepted by its recipient, member/director sign-in after assignment, password reset receipt after Auth SMTP is corrected, private resume/photo/evidence upload and download, and notification preferences/opt-out. Only one Class 4 member account is linked and no director account is linked, so the portal is not ready to share broadly until these role workflows pass.

## 5. Finish program setup before sharing
- Review all 36 active Class 4 member records and all 9 active director assignments against the final roster.
- Send a single director invitation as the first live test; confirm link receipt, account setup, director sign-in, and cohort-scoped access before inviting students.
- Add and verify the actual resources, point activity rules, meeting slides, handbook, NSBE Hub content, announcements, and calendar events.
- After accounts and content are ready, test member sign-in, point submission/review, resume upload/review, event and meeting workflows, notification preferences, and cross-account access denial.
- Point-guide limits such as one point total per activity per semester are recorded in the activity descriptions, but the database does not automatically enforce those semester caps or attendance thresholds. Directors must check the guide before awarding points; automatic enforcement remains a code task if desired.

## 6. Operations
Database measured 14 MB at the last size check; Storage currently has one private points-guide PDF (71,796 bytes). Audit history was preserved.
No plan change or purchase was made. Check the Supabase billing dashboard as real usage grows.
Existing security advisories: 13 legacy privileged public functions (role/ownership controls tested), leaked-password protection disabled, and four default-deny tables without policies. New privileged helpers live in the private schema.
Security advisory guidance: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
Google Drive integration remains optional and skipped.
