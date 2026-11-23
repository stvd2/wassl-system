// Vercel Serverless Function — نقطة /api/state (GET/PUT/POST/DELETE) — CommonJS
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireUser } = require('./_auth');
const { gzip } = require('node:zlib');
const { promisify } = require('node:util');
const gzipAsync = promisify(gzip);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STATE_ID = 'main';
const BUCKET = 'attachments';
const CACHE_TTL_MS = 250;
let stateCache;
let stateCacheAt = 0;
let stateCacheReady = false;
let stateReadPromise = null;

function invalidateStateCache() {
  stateCache = undefined;
  stateCacheAt = 0;
  stateCacheReady = false;
}

async function readState() {
  const now = Date.now();
  if (stateCacheReady && now - stateCacheAt < CACHE_TTL_MS) return { value: stateCache, cache: 'hit' };
  if (!stateReadPromise) {
    stateReadPromise = (async () => {
      const { data, error } = await supabase.from('app_state').select('data').eq('id', STATE_ID).maybeSingle();
      if (error) throw error;
      const value = data ? data.data : null;
      stateCache = value;
      stateCacheAt = Date.now();
      stateCacheReady = true;
      return value;
    })().finally(() => { stateReadPromise = null; });
  }
  return { value: await stateReadPromise, cache: 'miss' };
}

async function sendJson(req, res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (acceptsGzip && body.length >= 1024) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.end(await gzipAsync(body));
  } else res.end(body);
}

function expectedRevision(payload) {
  const value = payload?.meta?.sync_revision;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
const PRIVATE_USER_FIELDS = new Set([
  'password', 'password_hash', 'hash', 'salt', 'password_history',
  'failed_attempts', 'locked_until', 'temporary_password', 'plain_' + 'password'
]);
function sanitizeState(value) {
  if (!value || typeof value !== 'object') return value;
  const out = { ...value };
  if (Array.isArray(out.users)) out.users = out.users.map(user => {
    const safe = { ...user };
    for (const field of PRIVATE_USER_FIELDS) delete safe[field];
    return safe;
  });
  return out;
}
function validChatId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : '';
}
function chatAttachmentIds(chat, attachments) {
  const ids = new Set();
  for (const message of Array.isArray(chat?.messages) ? chat.messages : []) {
    for (const id of Array.isArray(message.atts) ? message.atts : []) if (/^[A-Za-z0-9_-]{1,120}$/.test(String(id))) ids.add(String(id));
  }
  for (const [id, meta] of Object.entries(attachments || {})) {
    if (String(meta?.referral_id || '') === `chat-${chat.id}` && /^[A-Za-z0-9_-]{1,120}$/.test(id)) ids.add(id);
  }
  return [...ids].sort();
}
function chatMember(chat, auth) {
  const userId = String(auth.authUser.id);
  if (chat.type === 'direct') return (chat.members || []).map(String).includes(userId);
  if (chat.category === 'all') return true;
  if (chat.category === 'custom') return (chat.members || []).map(String).includes(userId);
  return String(chat.category || '') === String(auth.profile.role || '');
}
async function clearChat(auth, body) {
  const chatId = validChatId(body.chat_id || body.chatId);
  if (!chatId) return { status: 400, payload: { error: 'معرّف المحادثة غير صالح' } };
  const expected = Number(body.expected_revision);
  if (!Number.isInteger(expected) || expected < 0) return { status: 400, payload: { error: 'إصدار المزامنة غير صالح' } };
  const { data: row, error: readError } = await supabase.from('app_state').select('data').eq('id', STATE_ID).maybeSingle();
  if (readError) throw readError;
  const current = row?.data;
  if (!current?.meta || current.meta.version !== 'v6') return { status: 500, payload: { error: 'حالة النظام غير صالحة' } };
  const revision = Number(current.meta.sync_revision || 0);
  if (expected !== revision) return { status: 409, payload: { error: 'تغيرت الحالة؛ نفّذ مزامنة ثم أعد المحاولة', revision } };
  const chat = (current.chats || []).find(item => String(item.id) === chatId);
  if (!chat || !chatMember(chat, auth)) return { status: 403, payload: { error: 'لا تملك عضوية هذه المحادثة' } };
  const ids = chatAttachmentIds(chat, current.attachments);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(ids.slice(i, i + 100));
    if (error) throw error;
  }
  const next = JSON.parse(JSON.stringify(current));
  const nextChat = next.chats.find(item => String(item.id) === chatId);
  nextChat.messages = [];
  nextChat.reads = {};
  for (const id of ids) delete next.attachments[id];
  next.meta = { ...(next.meta || {}), local_updated_at: new Date().toISOString() };
  const { data: saved, error: saveError } = await supabase.rpc('save_app_state', { expected_revision: revision, next_data: next });
  if (saveError) throw saveError;
  if (!saved?.ok) return { status: 409, payload: { error: 'تعذر حفظ مسح المحادثة بسبب تعارض مزامنة', revision } };
  invalidateStateCache();
  return { status: 200, payload: { ok: true, chatId, deletedAttachments: ids.length, messagesCleared: (chat.messages || []).length, data: saved.data, revision: saved.revision } };
}

module.exports = async function handler(req, res) {
  const { method } = req;
  try {
    const auth = await requireUser(req, { roles: ['admin', 'coordinator', 'doctor', 'beds'] });
    if (!auth.ok) return sendJson(req, res, auth.status, { error: auth.error });
    if (method === 'GET') {
      const result = await readState();
      res.setHeader('X-Wasl-State-Cache', result.cache);
      return sendJson(req, res, 200, sanitizeState(result.value));
    }
    if (method === 'PUT' || method === 'POST') {
      if (!['admin', 'coordinator', 'doctor', 'beds'].includes(auth.profile.role)) return sendJson(req, res, 403, { error: 'لا تملك صلاحية الحفظ' });
      if (req.body?.action === 'clear_chat') {
        const result = await clearChat(auth, req.body);
        return sendJson(req, res, result.status, result.payload);
      }
      const payload = sanitizeState(req.body);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendJson(req, res, 400, { error: 'body غير صالح' });
      const { data: result, error } = await supabase.rpc('save_app_state', {
        expected_revision: expectedRevision(payload),
        next_data: payload
      });
      if (error) throw error;
      if (!result?.ok) {
        return sendJson(req, res, 409, { error: 'تعارض مزامنة: توجد نسخة أحدث على جهاز آخر', conflict: true, current_revision: result?.current_revision ?? null });
      }
      invalidateStateCache();
      return sendJson(req, res, 200, { ok: true, data: result.data, revision: result.revision });
    }
    if (method === 'DELETE') {
      if (auth.profile.role !== 'admin') return sendJson(req, res, 403, { error: 'الحذف الشامل متاح لمدير النظام فقط' });
      // The current client-only roles cannot authorize destructive operations.
      // Fail closed until server-authenticated roles, maintenance locking,
      // complete storage pagination and a durable audit trail are implemented.
      return sendJson(req, res, 503, { error: 'الحذف الشامل معطّل مؤقتاً حتى تفعيل صلاحيات إدارية موثقة على الخادم' });
    }
    res.setHeader('Allow', 'GET, PUT, POST, DELETE');
    return sendJson(req, res, 405, { error: 'method not allowed' });
  } catch (error) {
    console.error('[WASL] /api/state:', error.message);
    return sendJson(req, res, 500, { error: 'Supabase request failed' });
  }
};
