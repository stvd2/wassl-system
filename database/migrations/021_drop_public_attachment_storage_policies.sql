-- Remove legacy public policies that allowed anonymous access to the private
-- attachments bucket. Authenticated conversation-scoped policies remain intact;
-- the server-side attachment API uses the service role.
BEGIN;

DROP POLICY IF EXISTS attachments_select ON storage.objects;
DROP POLICY IF EXISTS attachments_insert ON storage.objects;

COMMIT;
