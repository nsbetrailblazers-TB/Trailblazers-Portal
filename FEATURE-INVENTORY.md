# Trailblazers Portal — feature inventory

Implementation checked against the full inventory supplied September 23, 2026. Claims in the supplied document about what previously existed were not used as evidence.

The application source and connected Supabase database are updated. The website is **deployed to Vercel production** at https://trailblazers-portal.vercel.app (September 27, 2026). Supabase Auth setup links are delivered through the portal's Gmail sender; password recovery still depends on Supabase Auth SMTP. See [BLOCKED-FEATURES.md](BLOCKED-FEATURES.md) for live acceptance and content setup.

| # | Requested area | Implementation and practical limits |
|---|---|---|
| 1 | Authentication and roles | Supabase Auth, verified email linking, member/director/both/admin navigation, active cohort assignments, session restore, logout, and generated account invitation links delivered through the portal Gmail sender. Password recovery still uses Supabase Auth SMTP and needs a successful live check. |
| 2 | Member dashboard | Approved points and remaining requirement, completed/current required meetings, strikes, upcoming events, announcements and quick actions. Zero assigned meetings no longer appears as completion. |
| 3 | Points | Required JPG/PNG/WebP evidence, activity-rule defaults, categories, complete history, private evidence links, approve/deny/Needs Review, notes, awarded points, reviewer identity/time, search, cohort-scoped rules. Class 4's defaults come from the 2026–2027 guide. Directors manually verify per-semester limits and attendance thresholds before awarding; those caps are not automatically enforced. Legacy submissions cannot bypass picture evidence. |
| 4 | Google Drive | Authenticated server-side synchronization, cohort/member evidence folders, Cohort Documents, Reports, Shared Resources/categories; Drive IDs/URLs saved in Supabase. Automatic sync attempt after submission and staff retry controls. Requires organization Google OAuth setup; private Supabase evidence remains available meanwhile. |
| 5 | One-on-ones | Dynamic director requirements, schedule/reschedule, completed/reschedule-needed/canceled states, notes, change history, past directors retained, server-enforced in-person scheduling. Only authorized staff mark completion. |
| 6 | Member calendar | Monthly navigation, today, TB/NSBE/personal meeting categories, details, all-day and multi-day events. |
| 7 | Director events | Create/edit/cancel, cohort audience, date/time/all-day, location/TBD, description, meeting type, dress code, what to bring, monthly management calendar. |
| 8 | Full profiles | Identity/contact/academic/interests/community/social fields, pronouns, private photo, birthdays without year, favorite snack/candy/color, fun fact, dietary and accessibility forms. Sensitive information is stored separately. |
| 9 | Member profile editing | Full approved self-edit fields and alumni preferences through a whitelist. Cohort, program status, roles, points, strikes, and completion snapshots cannot be changed through that form. |
| 10 | Member directory | Search and filters for academic/community/career fields, point range, meeting completion, strikes, upcoming birthdays, plus explicitly authorized care filtering. Full profile and points/meeting/strike history. No team filter. |
| 11 | Add members | Complete roster form, zero starting totals, assignment-based meeting seeding. Admin-only, preserving your earlier explicit roster-permission decision. |
| 12 | Bulk members | CSV and Excel .xlsx first worksheet, preview, field validation, duplicate detection, extended fields including birthdays/dietary information, atomic database import. Create a cohort first. No formula execution; convert formulas to values. Up to 500 rows and 5 MB. |
| 13 | Director management | Create/edit/deactivate, titles/roles, dated cohort assignments, capability controls, bulk CSV/XLSX identities plus assignments. Previous history remains. Admin-only. |
| 14 | Strikes | Issue, resolve, remove/correct, resolution notes, issuer/time, preserved history, active-only counts, notification templates. |
| 15 | Announcements | Create/edit/publish/schedule/expire/archive, pin, cohort/global audience and director-only announcements. Scheduled email queue runs hourly when reminders are enabled. |
| 16 | Resources | Requested categories, external and Drive links, featured/active/order controls, editing and archiving, private resume-review uploads. |
| 17 | NSBE Hub | Director-editable titled content sections with text, links, ordering and cohort audience, alongside events/announcements. Staff supply their chapter-specific content in the editor. |
| 18 | New cohorts | Named cohorts/class numbers/date range/point requirement, director assignment, imports, Drive-folder setup control. No new source-code changes per cohort. |
| 19 | Archive/restore | Batch archive keeps profiles, points, evidence, strikes, meetings and resources; active members and assignments are ended. Completion snapshots preserve requirement counts for future archives. Restore cohort, then explicitly reactivate members/assignments. |
| 20 | Alumni directory | Opted-in archived members, safe public projection of cohort/name/major/minor/grad/orgs/career/role/company, conditional email/LinkedIn. No performance or care information. |
| 21 | Alumni preferences | Directory/email/LinkedIn visibility, role/company, LinkedIn link through the member profile form. |
| 22 | Alumni search | Names, cohort, major/minor, graduation year, organizations, career interests, company/title; cohort chips. |
| 23 | Email automation | Point receipt/decisions, strikes, welcome, meeting/event/deadline/low-point/profile reminders, birthday greetings and director birthday notifications. Queue/scheduler and email function deployed; external delivery activation remains. Hourly scheduler is installed but disabled until admin enables it. |
| 24 | Email templates | Admin subject/body/enabled editor, supported placeholder replacement at queue time. Existing queued notifications retain their rendered content. |
| 25 | Birthdays | Upcoming 30-day dashboard/report and birthday-day member/director notification queues. Month/day only. |
| 26 | Reports | Point progress, below/near requirement, pending, unscheduled/completed meeting counts, strikes, birthdays, participation submission counts, program completion, historical cohorts. This is portal-record participation, not attendance tracking. |
| 27 | Import/export | Member and director CSV/XLSX import; CSV member/cohort-filtered reports, points and one-on-ones exports. Exports escape spreadsheet-formula prefixes. |
| 28 | Audit trail | Database change history with actor, timestamp, before/after records; admin viewer. Latest 200 changes displayed; older rows retained in Supabase. |
| 29 | Settings | Typed portal-name/default-point-requirement/alumni-enabled/Fall and Spring deadline/reminder controls; portal reads supported settings and reminder generation uses the current semester deadline. Default points apply to new cohorts; existing requirements remain cohort-specific. |
| 30 | Director dashboard | Operational totals, attention list, upcoming events/birthdays, staff notification inbox, create-event/review-points/announcement/resource actions; admin add-member action. |
| 31 | Navigation | Management sections for members, points, meetings, events/calendar, strikes, resumes, announcements, resources, Hub, rules, birthdays and reports. Admin adds cohorts, directors, assignments, imports, templates, settings and audit. Legacy director calendar remains available. |
| 32 | UI polish | Consistent tables/forms/dialogs, loading/errors/empty states, selected/hover/focus styles, reduced motion, responsive layout, scrollable calendars/tables, correct zero-progress text, no added emojis. |

## Verification

- Nine Node tests pass: director regression, CSV parsing/extended validation, assignment dates, approved progress and calendar dates.
- Database tests run against the connected project in a rollback transaction: roles, identity bootstrap, cohort separation, review transitions, reviewer identity, in-person enforcement, history, evidence enforcement, private care, profile whitelist, notification preferences, templates, alumni privacy and archive snapshots.
- Expanded integration tests also verify atomic roster/care creation, director imports and meeting seeding, resolved strikes, full event fields, scoped point rules, settings, reminder generation and repeat-run deduplication.
- Browser XLSX harness passes stored/compressed ZIP, inline/shared strings and numeric values; rejects formulas and corrupt archives.
- Browser fixtures cover member/director/admin routes, full profile/roster forms, review choices, reports, and mobile layouts at 390 px. These are isolated test identities, not real users.
- Production static build succeeds. Only eight allowlisted application assets enter `release/`; test fixtures, SQL, server functions and secrets are excluded.

Real-account invitations/recovery, production file uploads, Google Drive delivery and email delivery remain acceptance checks after their configuration. No roster invitation or external email was sent during development testing.

## Security review

Supabase's security advisor reports no new public-table RLS omissions. The four intentionally private/default-deny tables have no direct user policies. Existing authenticated privileged RPCs remain guarded and are exercised by role tests; see [Supabase's privileged-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Leaked-password protection remains an Auth configuration item: [setup guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

