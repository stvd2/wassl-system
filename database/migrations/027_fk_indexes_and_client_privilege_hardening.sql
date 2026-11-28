-- 027_fk_indexes_and_client_privilege_hardening.sql
--
-- Purpose:
--   1. Add a normal B-tree index for every public foreign-key constraint that
--      is not already covered by the leading columns of a valid, non-partial
--      index on the referencing table.
--   2. Remove TRUNCATE, REFERENCES, and TRIGGER from PUBLIC, anon, and
--      authenticated on all public base tables.
--
-- Safety:
--   - No rows are deleted, moved, or updated.
--   - service_role is not revoked.
--   - CREATE INDEX IF NOT EXISTS makes the operation idempotent.
--   - Existing application CRUD grants are not changed.

BEGIN;

DO $do$
DECLARE
  fk RECORD;
  index_name text;
  column_list text;
BEGIN
  FOR fk IN
    SELECT
      c.oid AS constraint_oid,
      c.conrelid,
      n.nspname AS table_schema,
      tbl.relname AS table_name,
      c.conkey
    FROM pg_constraint AS c
    JOIN pg_class AS tbl ON tbl.oid = c.conrelid
    JOIN pg_namespace AS n ON n.oid = tbl.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND tbl.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index AS idx
        WHERE idx.indrelid = c.conrelid
          AND idx.indisvalid
          AND idx.indisready
          AND idx.indpred IS NULL
          AND (
            SELECT array_agg(idx.indkey[s] ORDER BY s)
            FROM generate_subscripts(idx.indkey, 1) AS gs(s)
            WHERE s <= cardinality(c.conkey)
          ) = c.conkey
      )
  LOOP
    SELECT string_agg(format('%I', att.attname), ', ' ORDER BY key.ordinality)
      INTO column_list
    FROM unnest(fk.conkey) WITH ORDINALITY AS key(attnum, ordinality)
    JOIN pg_attribute AS att
      ON att.attrelid = fk.conrelid
     AND att.attnum = key.attnum;

    index_name := left(
      format(
        'wasl_fk_%s_%s_idx',
        fk.table_name,
        regexp_replace(column_list, '[^a-zA-Z0-9_]+', '_', 'g')
      ),
      63
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
      index_name,
      fk.table_schema,
      fk.table_name,
      column_list
    );
  END LOOP;
END
$do$;

DO $do$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT n.nspname AS table_schema, c.relname AS table_name
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %I.%I FROM PUBLIC, anon, authenticated',
      table_record.table_schema,
      table_record.table_name
    );
  END LOOP;
END
$do$;

-- Keep future tables closed to client roles for these low-level privileges.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;

COMMIT;
