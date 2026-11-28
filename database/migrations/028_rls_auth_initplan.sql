-- 028_rls_auth_initplan.sql
--
-- Wrap direct auth.uid() calls in a scalar SELECT so PostgreSQL evaluates the
-- stable request-level value once per statement instead of once per row.
-- The boolean expressions and policy roles are otherwise unchanged.
-- No data is modified and no RLS policy is dropped.

BEGIN;

DO $do$
DECLARE
  policy_record RECORD;
  new_qual text;
  new_with_check text;
  alter_sql text;
BEGIN
  FOR policy_record IN
    SELECT
      pol.polname AS policy_name,
      ns.nspname AS schema_name,
      cls.relname AS table_name,
      pg_get_expr(pol.polqual, pol.polrelid) AS qual_expr,
      pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr
    FROM pg_policy AS pol
    JOIN pg_class AS cls ON cls.oid = pol.polrelid
    JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'public'
      AND (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%auth.uid()%'
        OR coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%auth.uid()%'
      )
  LOOP
    new_qual := replace(policy_record.qual_expr, 'auth.uid()', '(select auth.uid())');
    new_with_check := replace(policy_record.with_check_expr, 'auth.uid()', '(select auth.uid())');

    alter_sql := format(
      'ALTER POLICY %I ON %I.%I',
      policy_record.policy_name,
      policy_record.schema_name,
      policy_record.table_name
    );

    IF policy_record.qual_expr IS NOT NULL THEN
      alter_sql := alter_sql || format(' USING (%s)', new_qual);
    END IF;

    IF policy_record.with_check_expr IS NOT NULL THEN
      alter_sql := alter_sql || format(' WITH CHECK (%s)', new_with_check);
    END IF;

    EXECUTE alter_sql;
  END LOOP;
END
$do$;

COMMIT;
