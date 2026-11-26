-- Wasl v1.1 workflow hardening. Non-destructive and idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS public.wasl_allowed_transitions (
  from_status public.wasl_referral_status NOT NULL,
  to_status public.wasl_referral_status NOT NULL,
  role public.wasl_user_role NOT NULL,
  PRIMARY KEY (from_status, to_status, role)
);

INSERT INTO public.wasl_allowed_transitions(from_status,to_status,role) VALUES
 ('awaiting_doctor','doctor_accepted','doctor'),('awaiting_doctor','doctor_rejected','doctor'),('awaiting_doctor','info_requested','doctor'),('awaiting_doctor','consultation_done','doctor'),
 ('resubmitted','doctor_accepted','doctor'),('resubmitted','doctor_rejected','doctor'),('resubmitted','info_requested','doctor'),('resubmitted','consultation_done','doctor'),
 ('info_requested','resubmitted','coordinator'),('info_requested','resubmitted','admin'),
 ('consultation_done','completed','coordinator'),('consultation_done','completed','admin'),
 ('doctor_accepted','awaiting_bed','coordinator'),('doctor_accepted','awaiting_bed','admin'),('doctor_accepted','completed','coordinator'),('doctor_accepted','completed','admin'),
 ('doctor_rejected','completed','coordinator'),('doctor_rejected','completed','admin'),
 ('awaiting_bed','bed_approved','beds'),('awaiting_bed','bed_approved','admin'),('awaiting_bed','bed_rejected','beds'),('awaiting_bed','bed_rejected','admin'),
 ('bed_approved','completed','coordinator'),('bed_approved','completed','admin'),('bed_rejected','awaiting_bed','coordinator'),('bed_rejected','awaiting_bed','admin')
ON CONFLICT DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS public.wasl_ref_no_seq;
CREATE OR REPLACE FUNCTION public.next_ref_no() RETURNS text LANGUAGE plpgsql AS $$
DECLARE y text := to_char(now() AT TIME ZONE 'UTC', 'YYYY'); n bigint;
BEGIN n := nextval('public.wasl_ref_no_seq'); RETURN format('WASL-%s-%s', y, lpad(n::text, 6, '0')); END $$;

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
  IF NOT EXISTS (SELECT 1 FROM public.wasl_allowed_transitions WHERE from_status = r.status AND to_status = p_to_status AND role = role_name) THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  IF r.status = 'doctor_rejected' AND coalesce(nullif(trim(p_notes),''),'') = '' THEN RAISE EXCEPTION 'notes_required'; END IF;
  old_status := r.status;
  UPDATE public.referrals SET status = p_to_status, version = version + 1, notes = coalesce(p_notes, notes), completed_at = CASE WHEN p_to_status = 'completed' THEN now() ELSE completed_at END, updated_at = now() WHERE id = p_referral_id RETURNING * INTO r;
  INSERT INTO public.referral_v1_events(referral_id, actor_id, from_status, to_status, action, notes, details) VALUES (r.id, actor, old_status, p_to_status, 'transition', p_notes, jsonb_build_object('expected_version',p_expected_version,'expected_status',p_expected_status,'request_id',p_request_id));
  INSERT INTO public.wasl_audit_logs(actor_id, action, entity_type, entity_id, request_id, details) VALUES (actor,'transition','referral',r.id,p_request_id,jsonb_build_object('from',old_status,'to',p_to_status,'version',r.version));
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.wasl_transition_referral(uuid,integer,public.wasl_referral_status,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wasl_transition_referral_v1(uuid,integer,public.wasl_referral_status,public.wasl_referral_status,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_ref_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wasl_transition_referral_v1(uuid,integer,public.wasl_referral_status,public.wasl_referral_status,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_ref_no() TO service_role;

COMMIT;
