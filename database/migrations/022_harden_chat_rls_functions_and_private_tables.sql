-- Wasl security alignment: private helper function and conversation-scoped UPDATE policies.
-- Idempotent and non-destructive. The service API may continue to use service_role;
-- client roles are restricted by grants and RLS.
BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.is_conversation_member(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_members AS cm
    WHERE cm.conversation_id = p_conversation_id
      AND cm.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION app_private.is_conversation_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.is_conversation_member(uuid) TO authenticated, service_role;

ALTER FUNCTION public.next_ref_no() SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.next_ref_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_ref_no() TO service_role;

ALTER FUNCTION public.touch_auth_request() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public.touch_auth_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_auth_request() TO service_role;

DROP POLICY IF EXISTS conversation_messages_update_sender ON public.conversation_messages;
CREATE POLICY conversation_messages_update_sender
  ON public.conversation_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    AND app_private.is_conversation_member(conversation_id)
  )
  WITH CHECK (
    sender_id = auth.uid()
    AND app_private.is_conversation_member(conversation_id)
  );

DROP POLICY IF EXISTS conversation_attachments_update_owner ON public.conversation_attachments;
CREATE POLICY conversation_attachments_update_owner
  ON public.conversation_attachments
  FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()
    AND app_private.is_conversation_member(conversation_id)
  )
  WITH CHECK (
    owner_id = auth.uid()
    AND app_private.is_conversation_member(conversation_id)
  );

-- Remove the old RPC-visible helper after all policies point to app_private.
DROP FUNCTION IF EXISTS public.is_conversation_member(uuid);

COMMIT;
