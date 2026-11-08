# Trailblazers Portal setup

See [FEATURE-INVENTORY.md](FEATURE-INVENTORY.md) for the complete 32-area implementation checklist and [BLOCKED-FEATURES.md](BLOCKED-FEATURES.md) for the current launch-readiness steps.

The connected Supabase project is `vldbxkbczkqwclbbifkb`. Database changes are applied. Three Edge Functions are deployed: `invite-portal-user`, `send-notification-email`, and `sync-portal-drive`. The production website is live at https://trailblazers-portal.vercel.app. Account invitations use generated Auth links sent through the portal Gmail sender; password-reset delivery still depends on Supabase Auth SMTP. Real-account acceptance and roster/content setup remain pending.

## Local development and deployment

```powershell
node scripts/serve.cjs
# Open http://127.0.0.1:4173/
node --test tests/portal-utils.test.cjs tests/director-regression.test.cjs
node scripts/build.cjs
```

Vercel uses `vercel.json`: build command `node scripts/build.cjs`, output directory `release`. The production build contains eight application files only. Test pages, SQL, server functions and credentials are excluded. No npm packages are required for the website build.

For isolated browser checks, start `node scripts/serve.cjs --fixtures` and open `/test-preview?role=member`, `director`, or `admin`. These pages use fake data and never connect to Supabase. `/import-test` verifies stored/compressed XLSX files and formula/corruption rejection. Fixture routes are unavailable in normal preview mode.

## Permissions

Admin one-on-one controls were deployed November 1, 2026. Under Schedule → One-on-ones, admins can add completed meetings with any director (including inactive or unassigned directors), edit dates/details, undo completion with a reason, and award the one-on-one checklist point directly. Manual credit can also be added from Points → Check off an activity and edited, removed, or restored in the ledger. Manual credit and individual meeting completions satisfy the same single checklist point without double counting. Inactive/archived member history remains read-only. `supabase/portal_admin_one_on_one_control.sql` is already applied; do not rerun it. All 34 Node tests and both the existing activity SQL regression and `tests/admin-one-on-one-control.sql` passed; SQL fixtures were rolled back. The local browser preview could not connect, so authenticated browser verification remains unperformed.

- Members manage approved profile fields, their own private files, alumni visibility, preferences and meeting scheduling.
- Directors need an active identity and current cohort assignment. Capability defaults are points, strikes, resumes, content, events and meetings.
- Care information is separate and requires the explicit `care` capability (or member ownership/admin).
- Admins manage roster, imports, cohorts, director assignments, administrator access, global settings/templates and audit history.
- The designated first admin email is `nsbe.trailblazers@gmail.com`. It must complete verified Auth onboarding; a private one-time reservation handles the initial grant.

## Notifications

Event creation and editing include a checked-by-default **Notify members about this event** checkbox in both staff forms. Uncheck it to save without immediate member notifications or their emails. This choice applies to that save only; scheduled reminders continue to follow portal settings. The applied database change is preserved in `supabase/portal_event_notification_choice.sql`; `tests/event-notifications.sql` verifies silent and notifying saves, defaults, validation, and permissions with rolled-back fixtures.

Immediate workflow notifications use editable templates. Hourly reminders are installed but disabled until the real roster/content is ready and an administrator enables them. Gmail notification delivery passed a controlled inbox test. Account invitations also use that Gmail sender; password recovery uses the separate Supabase Auth SMTP configuration.

## Database source and verification

Remote Supabase migration history is authoritative. SQL source files in `supabase/` preserve the applied changes; **do not rerun them** against this project. The old `supabase/migrations` directory is not a complete fresh-project baseline. Pull a new baseline from the connected database before creating another environment.

Original operations files: `portal_operations.sql`, `portal_identity_and_hardening.sql`, `portal_guard_fix.sql`, `portal_events_and_validation.sql`, `portal_final_checks.sql`, `portal_history.sql`.

Inventory files: `portal_inventory.sql`, `portal_inventory_workflows.sql`, `portal_inventory_followup.sql`, `portal_notifications_inventory.sql`, `portal_drive_jobs.sql`, `portal_inventory_completion.sql`, `portal_inventory_permissions.sql`, `portal_scoped_point_rules.sql`, `portal_archive_snapshots.sql`, `portal_care_directory.sql`, `portal_review_identity.sql`.

The worker correction is preserved in `supabase/portal_reminder_alias_fix.sql`. Fall and Spring deadline settings/reminder selection are in `supabase/portal_seasonal_deadlines.sql`.

Run `tests/portal-security.sql` and `tests/portal-inventory.sql` as the database owner. They use test identities inside transactions and roll everything back. See the inventory document for the checks and remaining production acceptance work.

