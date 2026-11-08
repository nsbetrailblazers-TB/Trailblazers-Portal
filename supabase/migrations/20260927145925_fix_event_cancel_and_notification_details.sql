-- Allow authenticated users to invoke cancellation while keeping authorization
-- inside the SECURITY DEFINER function. Admins may cancel any event; directors
-- may cancel only active events assigned to their active cohort.
CREATE OR REPLACE FUNCTION public.cancel_calendar_event(p_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event_id uuid;
  v_is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign-in required.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.portal_admins AS pa
    WHERE pa.user_id = auth.uid()
      AND pa.active = true
  ) INTO v_is_admin;

  IF NOT v_is_admin AND NOT public.is_current_director() THEN
    RAISE EXCEPTION 'Director or administrator access required.';
  END IF;

  UPDATE public.meetings AS m
  SET active = false,
      updated_at = now()
  WHERE m.id = p_event_id
    AND m.active = true
    AND (
      v_is_admin
      OR EXISTS (
        SELECT 1
        FROM public.director_assignments AS da
        JOIN public.directors AS d ON d.id = da.director_id
        JOIN public.cohorts AS c ON c.id = da.cohort_id
        WHERE d.auth_user_id = auth.uid()
          AND d.active = true
          AND da.active = true
          AND c.status = 'active'
          AND da.cohort_id = m.cohort_id
      )
    )
  RETURNING m.id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Event not found or you do not have permission to cancel it.';
  END IF;

  RETURN v_event_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_calendar_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_calendar_event(uuid) TO authenticated;

-- Make point workflow emails identify the activity and decision in the subject
-- as well as the body. Existing queueing continues to substitute these fields.
UPDATE public.email_templates
SET subject = CASE template_key
      WHEN 'point_received' THEN 'Points submitted: {{activity_name}}'
      WHEN 'point_approved' THEN 'Points approved: {{activity_name}}'
      WHEN 'point_denied' THEN 'Points not approved: {{activity_name}}'
      WHEN 'point_needs_review' THEN 'Points need attention: {{activity_name}}'
      ELSE subject
    END,
    body = CASE template_key
      WHEN 'point_received' THEN 'Hi {{preferred_name}}, your submission for {{activity_name}} was received. It is awaiting director review. Only approved points count toward your requirement.'
      WHEN 'point_approved' THEN 'Hi {{preferred_name}}, your submission for {{activity_name}} was approved for {{points_awarded}} points. You can see your updated total in the Points section of the portal.'
      WHEN 'point_denied' THEN 'Hi {{preferred_name}}, your submission for {{activity_name}} was not approved. Review the note in your portal or contact your director if you have questions.'
      WHEN 'point_needs_review' THEN 'Hi {{preferred_name}}, your submission for {{activity_name}} needs additional review. Check your portal for the latest status and director note.'
      ELSE body
    END,
    updated_at = now()
WHERE template_key IN ('point_received','point_approved','point_denied','point_needs_review');
