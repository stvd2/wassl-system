-- Restrict the workflow transition matrix to trusted server-side reads.
-- The SECURITY DEFINER transition RPC executes as the table owner (postgres),
-- so normal application clients do not need direct access to this table.
BEGIN;

ALTER TABLE public.wasl_allowed_transitions ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.wasl_allowed_transitions
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.wasl_allowed_transitions TO service_role;

DROP POLICY IF EXISTS wasl_allowed_transitions_service_role_select
  ON public.wasl_allowed_transitions;
CREATE POLICY wasl_allowed_transitions_service_role_select
  ON public.wasl_allowed_transitions
  AS PERMISSIVE
  FOR SELECT
  TO service_role
  USING (true);

COMMIT;
