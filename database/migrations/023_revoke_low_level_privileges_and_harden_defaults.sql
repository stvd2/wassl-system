-- Remove residual client privileges from internal tables and harden future objects.
-- This does not alter application CRUD grants or delete data.
BEGIN;

DO $do$
DECLARE
  target_tables text[] := ARRAY[
    'auth_requests',
    'bed_requests',
    'beds',
    'notifications_outbox',
    'referral_consultations',
    'wasl_api_rate_limits',
    'wasl_idempotency_keys'
  ];
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY target_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated, PUBLIC',
        table_name
      );
    END IF;
  END LOOP;
END
$do$;

-- New objects created by the normal migration owner start closed to the Data API.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
