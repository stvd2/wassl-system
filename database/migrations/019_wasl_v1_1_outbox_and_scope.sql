-- Wasl v1.1 outbox and scope hardening. Non-destructive.
BEGIN;

CREATE TABLE IF NOT EXISTS public.notifications_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id uuid REFERENCES public.users(id),
  referral_id uuid REFERENCES public.referrals(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_outbox_pending_idx ON public.notifications_outbox(created_at) WHERE delivered_at IS NULL;
ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS latest_consultation_id uuid REFERENCES public.referral_consultations(id);

CREATE OR REPLACE FUNCTION public.wasl_transition_referral_v1(
  p_referral_id uuid, p_expected_version integer, p_expected_status public.wasl_referral_status,
  p_to_status public.wasl_referral_status, p_notes text DEFAULT NULL, p_request_id text DEFAULT NULL
) RETURNS public.referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE r public.referrals; actor uuid; role_name public.wasl_user_role; old_status public.wasl_referral_status;
BEGIN
  actor := app.current_wasl_user_id();
  IF actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO r FROM public.referrals WHERE id = p_referral_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'referral_not_found'; END IF;
  IF r.version <> p_expected_version OR r.status <> p_expected_status THEN RAISE EXCEPTION 'version_conflict'; END IF;
  SELECT role INTO role_name FROM public.users WHERE id = actor AND status = 'active';
  IF role_name = 'doctor' AND r.assigned_doctor_id <> actor THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF role_name = 'beds' AND NOT EXISTS (SELECT 1 FROM public.bed_requests WHERE referral_id = r.id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wasl_allowed_transitions WHERE from_status = r.status AND to_status = p_to_status AND role = role_name) THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  IF r.status = 'doctor_rejected' AND coalesce(nullif(trim(p_notes),''),'') = '' THEN RAISE EXCEPTION 'notes_required'; END IF;
  old_status := r.status;
  UPDATE public.referrals SET status = p_to_status, version = version + 1, notes = coalesce(p_notes, notes), completed_at = CASE WHEN p_to_status = 'completed' THEN now() ELSE completed_at END, updated_at = now() WHERE id = p_referral_id RETURNING * INTO r;
  INSERT INTO public.referral_v1_events(referral_id, actor_id, from_status, to_status, action, notes, details) VALUES (r.id, actor, old_status, p_to_status, 'transition', p_notes, jsonb_build_object('expected_version',p_expected_version,'expected_status',p_expected_status,'request_id',p_request_id));
  INSERT INTO public.wasl_audit_logs(actor_id, action, entity_type, entity_id, request_id, details) VALUES (actor,'transition','referral',r.id,p_request_id,jsonb_build_object('from',old_status,'to',p_to_status,'version',r.version));
  INSERT INTO public.notifications_outbox(event_type, user_id, referral_id, payload) VALUES ('referral.transition', NULL, r.id, jsonb_build_object('from_status',old_status,'to_status',p_to_status,'request_id',p_request_id));
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.wasl_transition_referral_v1(uuid,integer,public.wasl_referral_status,public.wasl_referral_status,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wasl_transition_referral_v1(uuid,integer,public.wasl_referral_status,public.wasl_referral_status,text,text) TO service_role;
COMMIT;
