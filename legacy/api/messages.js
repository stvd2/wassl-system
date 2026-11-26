'use strict';

const { requireUser } = require('./_auth');
const { admin, bodyOf, conversationId, conversationForMember, sendJson, uuid } = require('./_conversations');

const ROLES = ['admin', 'coordinator', 'doctor', 'beds'];
const MAX_BODY = 20000;

module.exports = async function handler(req, res) {
  try {
    const auth = await requireUser(req, { roles: ROLES });
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    const body = bodyOf(req) || {};
    const id = conversationId(req, body);
    if (!id) return sendJson(res, 400, { error: 'conversation_id مطلوب' });
    const conversation = await conversationForMember(id, auth.authUser.id);
    if (!conversation) return sendJson(res, 404, { error: 'المحادثة غير موجودة أو لا تملك عضويتها' });

    if (req.method === 'GET') {
      const requestedLimit = Number(req.query?.limit || 100);
      const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 100;
      let query = admin.from('conversation_messages')
        .select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      const before = String(req.query?.before || '').trim();
      if (before) {
        const { data: pivot, error: pivotError } = await admin.from('conversation_messages').select('created_at, id').eq('id', uuid(before)).eq('conversation_id', id).maybeSingle();
        if (pivotError) throw pivotError;
        if (!pivot) return sendJson(res, 400, { error: 'before غير صالح' });
        query = query.lt('created_at', pivot.created_at);
      }
      const { data, error } = await query;
      if (error) throw error;
      return sendJson(res, 200, { conversation, messages: (data || []).reverse() });
    }

    if (req.method === 'POST') {
      const text = typeof body.body === 'string' ? body.body : typeof body.text === 'string' ? body.text : '';
      if (!text.trim() || text.length > MAX_BODY) return sendJson(res, 400, { error: 'نص الرسالة غير صالح' });
      const { data, error } = await admin.from('conversation_messages').insert({ conversation_id: id, sender_id: auth.authUser.id, body: text }).select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at').single();
      if (error) throw error;
      await admin.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id);
      return sendJson(res, 201, { message: data });
    }

    const messageId = uuid(req.query?.message_id || req.query?.messageId || body.message_id || body.messageId);
    if (!messageId) return sendJson(res, 400, { error: 'message_id مطلوب' });
    const { data: message, error: readError } = await admin.from('conversation_messages').select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at').eq('id', messageId).eq('conversation_id', id).maybeSingle();
    if (readError) throw readError;
    if (!message) return sendJson(res, 404, { error: 'الرسالة غير موجودة' });
    if (message.sender_id !== auth.authUser.id) return sendJson(res, 403, { error: 'تعديل الرسالة متاح لمرسلها فقط' });

    if (req.method === 'PATCH') {
      const text = typeof body.body === 'string' ? body.body : typeof body.text === 'string' ? body.text : '';
      if (!text.trim() || text.length > MAX_BODY) return sendJson(res, 400, { error: 'نص الرسالة غير صالح' });
      const { data, error } = await admin.from('conversation_messages').update({ body: text, edited_at: new Date().toISOString() }).eq('id', messageId).select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at').single();
      if (error) throw error;
      return sendJson(res, 200, { message: data });
    }

    if (req.method === 'DELETE') {
      const { data, error } = await admin.from('conversation_messages').update({ deleted_at: new Date().toISOString(), body: '' }).eq('id', messageId).select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at').single();
      if (error) throw error;
      return sendJson(res, 200, { message: data });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return sendJson(res, 405, { error: 'method not allowed' });
  } catch (error) {
    console.error('[WASL] /api/messages:', error.message);
    return sendJson(res, 500, { error: 'فشل طلب الرسائل' });
  }
};
