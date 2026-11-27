-- Normalize SECURITY DEFINER search paths without changing function behavior.
-- Missing legacy functions are skipped so this remains safe across environments.
BEGIN;

DO $do$
DECLARE
  signature text;
  signatures text[] := ARRAY[
    'public.touch_user_profile()',
    'public.touch_auth_request()',
    'public.wasl_consume_rate_limit(text,integer,integer)',
    'public.wasl_cleanup_rate_limits(integer)',
    'public.wasl_append_auth_notification(uuid,text,text,text)',
    'public.wasl_create_conversation(uuid,text,text,uuid[])',
    'public.touch_app_state()',
    'public.wasl_transition_referral(uuid,integer,public.wasl_referral_status,text,text)',
    'public.wasl_transition_referral_v1(uuid,integer,public.wasl_referral_status,public.wasl_referral_status,text,text)',
    'app.current_wasl_user_id()',
    'app.wasl_role()',
    'app.wasl_can_access_referral(uuid)'
  ];
BEGIN
  FOREACH signature IN ARRAY signatures LOOP
    IF to_regprocedure(signature) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, app', signature);
    END IF;
  END LOOP;
END
$do$;

COMMIT;
