'use strict';

const { requireUser } = require('./_auth');
const {
  admin, bodyOf, conversationId, conversationForMember, membersFor, sendJson, uuid
} = require('./_conversations');

const ROLES = ['admin', 'coordinator', 'doctor', 'beds'];

async function listConversations(userId) {
  const { data: memberships, error: membershipError } = await admin
    .from('conversation_members')
    .select('conversation_id, member_role, joined_at')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });
  if (membershipError) throw membershipError;
  const ids = (memberships || []).map(row => row.conversation_id);
  if (!ids.length) return [];
  const { data: conversations, error } = await admin
    .from('conversations')
    .select('id, conversation_type, title, created_by, created_at, updated_at')
    .in('id', ids)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const roleByConversation = new Map((memberships || []).map(row => [row.conversation_id, row.member_role]));
  return (conversations || []).map(row => ({ ...row, member_role: roleByConversation.get(row.id) || 'member' }));
}

module.exports = async function handler(req, res) {
  try {
    const auth = await requireUser(req, { roles: ROLES });
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    const body = bodyOf(req) || {};
    const id = conversationId(req, body);

    if (req.method === 'GET') {
      if (!id) return sendJson(res, 200, { conversations: await listConversations(auth.authUser.id) });
      const conversation = await conversationForMember(id, auth.authUser.id);
      if (!conversation) return sendJson(res, 404, { error: 'المحادثة غير موجودة أو لا تملك عضويتها' });
      return sendJson(res, 200, { conversation, members: await membersFor(id) });
    }

    if (req.method === 'POST') {
      const type = body.conversation_type === 'group' ? 'group' : 'direct';
      const requested = Array.isArray(body.member_ids) ? body.member_ids.map(uuid).filter(Boolean) : [];
      const memberIds = [...new Set([auth.authUser.id, ...requested])];
      if (type === 'direct' && memberIds.length !== 2) return sendJson(res, 400, { error: 'المحادثة المباشرة تحتاج مستخدمين اثنين' });
      if (type === 'group' && memberIds.length < 2) return sendJson(res, 400, { error: 'المجموعة تحتاج عضواً آخر على الأقل' });
      const title = body.title == null ? null : String(body.title).trim().slice(0, 200) || null;

      const { data: created, error: createError } = await admin.rpc('wasl_create_conversation', {
        p_creator: auth.authUser.id,
        p_type: type,
        p_title: title,
        p_member_ids: memberIds
      });
      if (createError) throw createError;
      return sendJson(res, 201, created);
    }

    if (req.method === 'PATCH') {
      if (!id) return sendJson(res, 400, { error: 'conversation_id مطلوب' });
      const conversation = await conversationForMember(id, auth.authUser.id);
      if (!conversation) return sendJson(res, 404, { error: 'المحادثة غير موجودة أو لا تملك عضويتها' });
      if (conversation.created_by !== auth.authUser.id) return sendJson(res, 403, { error: 'تعديل المحادثة متاح لمنشئها فقط' });
      const title = body.title == null ? null : String(body.title).trim().slice(0, 200) || null;
      const { data, error } = await admin.from('conversations').update({ title, updated_at: new Date().toISOString() }).eq('id', id).select('id, conversation_type, title, created_by, created_at, updated_at').single();
      if (error) throw error;
      return sendJson(res, 200, { conversation: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return sendJson(res, 400, { error: 'conversation_id مطلوب' });
      const conversation = await conversationForMember(id, auth.authUser.id);
      if (!conversation) return sendJson(res, 404, { error: 'المحادثة غير موجودة أو لا تملك عضويتها' });
      if (conversation.created_by !== auth.authUser.id) return sendJson(res, 403, { error: 'حذف المحادثة متاح لمنشئها فقط' });
      const { error } = await admin.from('conversations').delete().eq('id', id);
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return sendJson(res, 405, { error: 'method not allowed' });
  } catch (error) {
    console.error('[WASL] /api/conversations:', error.message);
    return sendJson(res, 500, { error: 'فشل طلب المحادثات' });
  }
};
