-- Wasl v1.1 authoritative relational core
-- Non-destructive: does not drop, truncate, delete, or rewrite legacy app_state data.
-- Apply after database/001..005. The legacy JSON API remains frozen until the v1 API cutover.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

DO $$ BEGIN CREATE TYPE public.wasl_user_role AS ENUM ('admin','coordinator','doctor','beds'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.wasl_user_status AS ENUM ('pending','active','rejected','disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.wasl_referral_priority AS ENUM ('normal','urgent','emergency'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.wasl_referral_status AS ENUM ('awaiting_doctor','info_requested','resubmitted','consultation_done','doctor_accepted','doctor_rejected','awaiting_bed','bed_approved','bed_rejected','completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.wasl_bed_status AS ENUM ('available','reserved','occupied','maintenance','inactive'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.wasl_bed_request_status AS ENUM ('pending','approved','rejected','cancelled','resubmitted'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.wasl_scan_status AS ENUM ('pending','clean','infected','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(100) NOT NULL UNIQUE,
  employee_no varchar(50) UNIQUE,
  full_name varchar(200) NOT NULL,
  mobile varchar(30),
  email varchar(255),
  role public.wasl_user_role NOT NULL,
  status public.wasl_user_status NOT NULL DEFAULT 'pending',
  auth_user_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no varchar(50) NOT NULL UNIQUE,
  patient_name varchar(200) NOT NULL,
  patient_identifier varchar(100),
  date_of_birth date,
  patient_age integer CHECK (patient_age IS NULL OR patient_age BETWEEN 0 AND 130),
  patient_gender varchar(20),
  priority public.wasl_referral_priority NOT NULL,
  admission_type varchar(30) NOT NULL,
  department_id uuid NOT NULL REFERENCES public.departments(id),
  status public.wasl_referral_status NOT NULL DEFAULT 'awaiting_doctor',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES public.users(id),
  assigned_doctor_id uuid REFERENCES public.users(id),
  clinical_summary text,
  diagnosis text,
  notes text,
  needed_info text,
  supplement_notes text,
  doctor_decision varchar(30),
  doctor_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  archived_at timestamptz,
  archived_by uuid REFERENCES public.users(id),
  archive_reason text
);

CREATE TABLE IF NOT EXISTS public.referral_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals(id),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  status varchar(30) NOT NULL DEFAULT 'draft',
  opinion text,
  recommendations text,
  responded_by uuid REFERENCES public.users(id),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referral_v1_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals(id),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  from_status public.wasl_referral_status,
  to_status public.wasl_referral_status NOT NULL,
  action varchar(100) NOT NULL,
  notes text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  number varchar(50) NOT NULL,
  status public.wasl_bed_status NOT NULL DEFAULT 'available',
  room varchar(100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(department_id, number)
);

CREATE TABLE IF NOT EXISTS public.bed_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals(id),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  bed_id uuid REFERENCES public.beds(id),
  status public.wasl_bed_request_status NOT NULL DEFAULT 'pending',
  reason text,
  decision_notes text,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  decided_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referral_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals(id),
  uploaded_by uuid NOT NULL REFERENCES public.users(id),
  storage_bucket text NOT NULL DEFAULT 'attachments',
  storage_path text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 26214400),
  sha256 text,
  scan_status public.wasl_scan_status NOT NULL DEFAULT 'pending',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wasl_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  request_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wasl_idempotency_keys (
  key text PRIMARY KEY,
  actor_id uuid REFERENCES public.users(id),
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Compatibility columns on the pre-v1 event table; no existing rows are removed.
ALTER TABLE public.referral_events ADD COLUMN IF NOT EXISTS referral_id uuid;
ALTER TABLE public.referral_events ADD COLUMN IF NOT EXISTS details jsonb;

CREATE INDEX IF NOT EXISTS referrals_status_idx ON public.referrals(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS referrals_doctor_idx ON public.referrals(assigned_doctor_id, status);
CREATE INDEX IF NOT EXISTS referral_v1_events_referral_idx ON public.referral_v1_events(referral_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bed_requests_active_idx ON public.bed_requests(referral_id) WHERE status IN ('pending','approved','resubmitted');
CREATE INDEX IF NOT EXISTS attachments_referral_idx ON public.referral_attachments(referral_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS audit_entity_idx ON public.wasl_audit_logs(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.current_wasl_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT id FROM public.users WHERE auth_user_id = auth.uid() AND status = 'active' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.wasl_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT role::text FROM public.users WHERE auth_user_id = auth.uid() AND status = 'active' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.wasl_can_access_referral(p_referral_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.referrals r
    WHERE r.id = p_referral_id AND (
      app.wasl_role() IN ('admin','coordinator')
      OR (app.wasl_role() = 'doctor' AND r.assigned_doctor_id = app.current_wasl_user_id())
      OR (app.wasl_role() = 'beds' AND EXISTS (SELECT 1 FROM public.bed_requests b WHERE b.referral_id = r.id)
    )
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.wasl_transition_referral(
  p_referral_id uuid, p_expected_version integer, p_to_status public.wasl_referral_status,
  p_notes text DEFAULT NULL, p_request_id text DEFAULT NULL
) RETURNS public.referrals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
DECLARE r public.referrals; actor uuid; role_name text;
DECLARE old_status public.wasl_referral_status;
BEGIN
  actor := app.current_wasl_user_id(); role_name := app.wasl_role();
  IF actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO r FROM public.referrals WHERE id = p_referral_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'referral_not_found'; END IF;
  IF r.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  IF r.status = 'completed' AND NOT (p_to_status = 'completed' AND role_name = 'admin') THEN RAISE EXCEPTION 'completed_is_final'; END IF;
  IF r.status = 'doctor_rejected' AND p_to_status = 'completed' AND role_name NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.status = 'doctor_rejected' AND p_to_status = 'completed' AND coalesce(nullif(trim(p_notes),''),'') = '' THEN RAISE EXCEPTION 'notes_required'; END IF;
  old_status := r.status;
  UPDATE public.referrals SET status = p_to_status, version = version + 1, notes = coalesce(p_notes, notes), completed_at = CASE WHEN p_to_status = 'completed' THEN now() ELSE completed_at END, updated_at = now() WHERE id = p_referral_id RETURNING * INTO r;
  INSERT INTO public.referral_v1_events(referral_id, actor_id, from_status, to_status, action, notes, details) VALUES (r.id, actor, old_status, p_to_status, 'transition', p_notes, jsonb_build_object('expected_version',p_expected_version,'request_id',p_request_id));
  INSERT INTO public.wasl_audit_logs(actor_id, action, entity_type, entity_id, request_id, details) VALUES (actor,'transition','referral',r.id,p_request_id,jsonb_build_object('from',old_status,'to',p_to_status,'version',r.version));
  RETURN r;
END $$;

-- RLS defaults to deny; service_role remains the controlled server path.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_v1_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bed_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wasl_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wasl_idempotency_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY users_self_or_admin ON public.users FOR SELECT USING (auth_user_id = auth.uid() OR app.wasl_role() = 'admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY departments_authenticated_read ON public.departments FOR SELECT USING (auth.uid() IS NOT NULL); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY referrals_scoped_read ON public.referrals FOR SELECT USING (app.wasl_can_access_referral(id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY referral_events_scoped_read ON public.referral_v1_events FOR SELECT USING (app.wasl_can_access_referral(referral_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY attachments_scoped_read ON public.referral_attachments FOR SELECT USING (app.wasl_can_access_referral(referral_id) AND deleted_at IS NULL); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY audit_admin_read ON public.wasl_audit_logs FOR SELECT USING (app.wasl_role() = 'admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Harden the legacy trigger without changing its data behavior.
ALTER FUNCTION public.touch_app_state() SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.touch_app_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_app_state(integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_app_state(integer, jsonb) TO service_role;

COMMIT;
