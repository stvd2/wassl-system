'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireUser } = require('./_auth');

const STATE_ID = 'main';
const BUCKET = 'attachments';
const MAX_BODY = 64 * 1024;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('الطلب أكبر من الحد المسموح'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validChatId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : '';
}

function attachmentIds(chat, attachments) {
  const ids = new Set();
  for (const message of Array.isArray(chat?.messages) ? chat.messages : []) {
    for (const id of Array.isArray(message.atts) ? message.atts : []) {
      if (/^[A-Za-z0-9_-]{1,120}$/.test(String(id))) ids.add(String(id));
    }
  }
  for (const [id, meta] of Object.entries(attachments || {})) {
    if (String(meta?.referral_id || '') === `chat-${chat.id}` && /^[A-Za-z0-9_-]{1,120}$/.test(id)) ids.add(id);
  }
  return [...ids].sort();
}

function isMember(chat, auth) {
  const userId = String(auth.authUser.id);
  if (chat.type === 'direct') return (chat.members || []).map(String).includes(userId);
  if (chat.category === 'all') return true;
  if (chat.category === 'custom') return (chat.members || []).map(String).includes(userId);
  return String(chat.category || '') === String(auth.profile.role || '');
}

async function removeStorage(ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const group = ids.slice(i, i + 100);
    const { error } = await supabase.storage.from(BUCKET).remove(group);
    if (error) throw error;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method not allowed' });
  }
  try {
    const auth = await requireUser(req, { roles: ['admin', 'coordinator', 'doctor', 'beds'] });
    if (!auth.ok) return send(res, auth.status, { error: auth.error });
    const body = await readJson(req);
    const chatId = validChatId(body.chat_id || body.chatId);
    if (!chatId) return send(res, 400, { error: 'معرّف المحادثة غير صالح' });
    const expectedRevision = Number(body.expected_revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return send(res, 400, { error: 'إصدار المزامنة غير صالح' });

    const { data: row, error: readError } = await supabase.from('app_state').select('data').eq('id', STATE_ID).maybeSingle();
    if (readError) throw readError;
    const current = row?.data;
    if (!current?.meta || current.meta.version !== 'v6') return send(res, 500, { error: 'حالة النظام غير صالحة' });
    const revision = Number(current.meta.sync_revision || 0);
    if (expectedRevision !== revision) return send(res, 409, { error: 'تغيرت الحالة؛ نفّذ مزامنة ثم أعد المحاولة', revision });

    const chat = (current.chats || []).find(item => String(item.id) === chatId);
    if (!chat || !isMember(chat, auth)) return send(res, 403, { error: 'لا تملك عضوية هذه المحادثة' });
    const ids = attachmentIds(chat, current.attachments);
    await removeStorage(ids);

    const next = JSON.parse(JSON.stringify(current));
    const nextChat = next.chats.find(item => String(item.id) === chatId);
    nextChat.messages = [];
    nextChat.reads = {};
    for (const id of ids) delete next.attachments[id];
    next.meta = { ...(next.meta || {}), local_updated_at: new Date().toISOString() };
    const { data: saved, error: saveError } = await supabase.rpc('save_app_state', {
      expected_revision: revision,
      next_data: next
    });
    if (saveError) throw saveError;
    if (!saved?.ok) return send(res, 409, { error: 'تعذر حفظ مسح المحادثة بسبب تعارض مزامنة', revision });
    return send(res, 200, {
      ok: true,
      chatId,
      deletedAttachments: ids.length,
      messagesCleared: Array.isArray(chat.messages) ? chat.messages.length : 0,
      data: saved.data,
      revision: saved.revision
    });
  } catch (error) {
    console.error('[WASL] /api/chat-clear:', error.message);
    return send(res, error.statusCode || 500, { error: 'فشل مسح المحادثة' });
  }
};
