-- Bug reports are submitted through an authenticated Edge Function. Keep
-- report contents inaccessible to browser roles; only the service role writes.
CREATE TABLE public.portal_bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL,
  reporter_email text NOT NULL,
  reporter_role text NOT NULL CHECK (reporter_role IN ('trailblazer', 'director', 'admin_or_other')),
  location text NOT NULL CHECK (length(location) BETWEEN 1 AND 200),
  error_message text NOT NULL CHECK (length(error_message) BETWEEN 1 AND 4000),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 6000),
  delivery_status text NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('queued', 'sent', 'failed')),
  delivery_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX portal_bug_reports_reporter_created_at_idx
  ON public.portal_bug_reports (reporter_user_id, created_at DESC);

ALTER TABLE public.portal_bug_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.portal_bug_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.portal_bug_reports TO service_role;
