# Points, uploads and navigation update — September 23, 2026

## Admin point resets

Open Admin Portal → Points. Choose Reset all active points or Reset one member’s points and type RESET.

Reset clears awarded points on approved submissions. Submission records, evidence, review information and before/after audit records remain. Pending reviews are unchanged. Bulk reset uses all members whose program status is active across every cohort; it does not use the current search/cohort filter. No production point reset was performed during implementation.

## Fixes

- One shared logout handler for member, director and admin pages, including open dialog cleanup and error reporting.
- Director loading runs independent queries concurrently, shows loading feedback and prevents duplicate clicks; later navigation cancels the pending view switch.
- Home announcements appear above the next event. The banner selects the earliest event or one-on-one and includes all-day calendar dates.
- Active members can submit PDF resumes even if their cohort is archived. Points still require an active cohort. The PDF suffix validation was also corrected.
- File selectors, director event controls, and spacing around director upcoming sections have been restyled.
- Director create/edit event uses the same validated event endpoint as management, including explicit all-day dates and duplicate-submit protection.

## Verification

- Ten Node tests passed (calendar selection, director refresh, CSV/import validation and progress).
- `tests/points-reset-resume.sql` passed with rollback: admin enforcement, confirmation, individual/all-active reset scope, audit, resume storage/record insertion, foreign-owner rejection and archived-cohort point-upload rejection. Test changes were rolled back.
- Browser fixtures: every member, director and admin navigation section; member/director view switching; director event open/cancel; reset confirmation; logout in each role.
- Director event form fits a 390px viewport without horizontal page overflow.
- Production account file transfer and destructive reset actions were not performed as browser tests.

Applied database source: `supabase/portal_points_reset_and_resume.sql`. Do not rerun it on the connected project; migration history is authoritative.
