'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireUser } = require('./_auth');
const { admin, isMember, uuid } = require('./_conversations');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = 'attachments';
const MAX_BYTES = 15 * 1024 * 1024;
const MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']);
const ACCEPTANCE_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function idFrom(req) {
  const value = String(req.query?.id || req.headers['x-attachment-id'] || '').trim();
  return /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : '';
}
function conversationFrom(req) { return uuid(req.query?.conversation_id || req.headers['x-conversation-id']); }
function messageFrom(req) { return uuid(req.query?.message_id || req.headers['x-message-id']); }
function outgoingContextFrom(req) {
  const referralId = String(req.query?.referral_id || req.headers['x-referral-id'] || '').trim();
  const category = String(req.query?.category || req.headers['x-attachment-category'] || '').trim();
  if (referralId && !/^[A-Za-z0-9_-]{1,160}$/.test(referralId)) return null;
  if (category && !/^[A-Za-z0-9_-]{1,80}$/.test(category)) return null;
  return { referralId, category };
}
function originalNameFrom(req, id) { return String(req.query?.name || req.headers['x-original-name'] || id).trim().slice(0, 255) || id; }
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.statusCode = status; res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'private, no-store'); res.end(body);
}
async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > MAX_BYTES) throw Object.assign(new Error('الملف أكبر من 15 م.ب'), { statusCode: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function attachmentFor(path) {
  const { data, error } = await admin.from('conversation_attachments').select('id, conversation_id, message_id, owner_id, storage_bucket, storage_path, original_name, mime_type, byte_size, created_at').eq('storage_bucket', BUCKET).eq('storage_path', path).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function outgoingReferral(referralId) {
  const { data, error } = await admin.from('app_state').select('data').eq('id', 'main').maybeSingle();
  if (error) throw error;
  const referrals = Array.isArray(data?.data?.outgoing_referrals) ? data.data.outgoing_referrals : [];
  return referrals.find(item => String(item?.id || '') === referralId) || null;
}
function canAccessOutgoing(referral, auth) {
  const role = String(auth.profile?.role || '');
  if (role === 'admin' || role === 'coordinator') return true;
  const userId = String(auth.authUser?.id || '');
  return role === 'doctor' && [referral?.created_by, referral?.doctor_id].map(String).includes(userId);
}
async function handleOutgoing(req, res, auth, context, id) {
  if (context.category !== 'acceptance_letter' || !context.referralId) return send(res, 400, JSON.stringify({ error: 'خطاب القبول يتطلب referral_id وcategory=acceptance_letter' }));
  const referral = await outgoingReferral(context.referralId);
  if (!referral) return send(res, 404, JSON.stringify({ error: 'الإحالة الصادرة غير موجودة' }));
  const role = String(auth.profile?.role || '');
  const linkedId = String(referral.acceptance_letter_attachment_id || '');
  if (req.method === 'PUT' || req.method === 'POST') {
    if (!['coordinator', 'admin'].includes(role)) return send(res, 403, JSON.stringify({ error: 'رفع خطاب القبول متاح للمنسق أو المدير فقط' }));
    if (linkedId && linkedId !== id) return send(res, 409, JSON.stringify({ error: 'للإحالة خطاب قبول مرتبط مسبقاً؛ حدّث السجل أولاً' }));
    const contentType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].toLowerCase();
    if (!ACCEPTANCE_MIME_TYPES.has(contentType)) return send(res, 415, JSON.stringify({ error: 'نوع خطاب القبول غير مسموح' }));
    const body = await readBody(req);
    if (!body.length || body.length > MAX_BYTES) return send(res, 413, JSON.stringify({ error: 'حجم الملف غير صالح' }));
    const { error } = await supabase.storage.from(BUCKET).upload(id, body, { contentType, upsert: true, cacheControl: '3600' });
    if (error) throw error;
    return send(res, 200, JSON.stringify({ ok: true, id, attachment: { id, category: 'acceptance_letter', referral_id: context.referralId, original_name: originalNameFrom(req, id), mime_type: contentType, size: body.length, uploaded_by: auth.authUser.id, uploaded_at: new Date().toISOString() } }));
  }
  if (!canAccessOutgoing(referral, auth)) return send(res, 403, JSON.stringify({ error: 'لا تملك صلاحية هذه الإحالة' }));
  if (req.method === 'GET') {
    if (linkedId !== id) return send(res, 404, JSON.stringify({ error: 'خطاب القبول غير مرتبط بهذه الإحالة' }));
    const { data, error } = await supabase.storage.from(BUCKET).download(id);
    if (error || !data) return send(res, 404, JSON.stringify({ error: 'المرفق غير موجود' }));
    const buf = Buffer.from(await data.arrayBuffer()); res.statusCode = 200; res.setHeader('Content-Type', data.type || 'application/octet-stream'); res.setHeader('Content-Length', String(buf.length)); res.setHeader('Cache-Control', 'private, no-store'); return res.end(buf);
  }
  if (req.method === 'DELETE') return send(res, 409, JSON.stringify({ error: 'أزل ارتباط الخطاب من الإحالة عبر /api/state قبل حذف الملف' }));
  res.setHeader('Allow', 'GET, PUT, POST, DELETE'); return send(res, 405, JSON.stringify({ error: 'method not allowed' }));
}

module.exports = async function handler(req, res) {
  const id = idFrom(req); if (!id) return send(res, 400, JSON.stringify({ error: 'معرّف المرفق غير صالح' }));
  const path = id; const conversationId = conversationFrom(req);
  try {
    const auth = await requireUser(req, { roles: ['admin', 'coordinator', 'doctor', 'beds'] });
    if (!auth.ok) return send(res, auth.status, JSON.stringify({ error: auth.error }));
    const outgoing = outgoingContextFrom(req); if (!outgoing) return send(res, 400, JSON.stringify({ error: 'سياق المرفق غير صالح' }));
    if (outgoing.category) return handleOutgoing(req, res, auth, outgoing, id);
    if (!conversationId) return send(res, 400, JSON.stringify({ error: 'conversation_id مطلوب للتحقق من عضوية المرفق' }));
    if (!(await isMember(conversationId, auth.authUser.id))) return send(res, 403, JSON.stringify({ error: 'لا تملك عضوية هذه المحادثة' }));
    let record = await attachmentFor(path);
    if (record && record.conversation_id !== conversationId) return send(res, 403, JSON.stringify({ error: 'المرفق مرتبط بمحادثة أخرى' }));
    if (req.method === 'PUT' || req.method === 'POST') {
      const contentType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].toLowerCase();
      if (!MIME_TYPES.has(contentType)) return send(res, 415, JSON.stringify({ error: 'نوع الملف غير مسموح' }));
      const body = await readBody(req); if (!body.length || body.length > MAX_BYTES) return send(res, 413, JSON.stringify({ error: 'حجم الملف غير صالح' }));
      if (record && record.owner_id !== auth.authUser.id && auth.profile.role !== 'admin') return send(res, 403, JSON.stringify({ error: 'لا تملك المرفق' }));
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: true, cacheControl: '3600' }); if (uploadError) throw uploadError;
      const values = { conversation_id: conversationId, message_id: messageFrom(req) || null, owner_id: record?.owner_id || auth.authUser.id, storage_bucket: BUCKET, storage_path: path, original_name: originalNameFrom(req, id), mime_type: contentType, byte_size: body.length };
      const { data: saved, error: metadataError } = await admin.from('conversation_attachments').upsert(values, { onConflict: 'storage_bucket,storage_path' }).select('id, conversation_id, message_id, owner_id, storage_bucket, storage_path, original_name, mime_type, byte_size, created_at').single();
      if (metadataError) { await supabase.storage.from(BUCKET).remove([path]); throw metadataError; }
      return send(res, 200, JSON.stringify({ ok: true, id, attachment: saved }));
    }
    if (req.method === 'GET') {
      if (!record || record.conversation_id !== conversationId) return send(res, 404, JSON.stringify({ error: 'بيانات المرفق غير موجودة' }));
      const { data, error } = await supabase.storage.from(BUCKET).download(path); if (error || !data) return send(res, 404, JSON.stringify({ error: 'المرفق غير موجود' }));
      const buf = Buffer.from(await data.arrayBuffer()); res.statusCode = 200; res.setHeader('Content-Type', record.mime_type || data.type || 'application/octet-stream'); res.setHeader('Content-Length', String(buf.length)); res.setHeader('Cache-Control', 'private, no-store'); return res.end(buf);
    }
    if (req.method === 'DELETE') {
      if (!record) return send(res, 404, JSON.stringify({ error: 'المرفق غير موجود' }));
      if (record.owner_id !== auth.authUser.id && auth.profile.role !== 'admin') return send(res, 403, JSON.stringify({ error: 'لا تملك المرفق' }));
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([path]); if (storageError) throw storageError;
      const { error: metadataError } = await admin.from('conversation_attachments').delete().eq('id', record.id); if (metadataError) throw metadataError;
      return send(res, 200, JSON.stringify({ ok: true, id }));
    }
    res.setHeader('Allow', 'GET, PUT, POST, DELETE'); return send(res, 405, JSON.stringify({ error: 'method not allowed' }));
  } catch (error) { console.error('[WASL] /api/attachment:', error.message); return send(res, error.statusCode || 500, JSON.stringify({ error: 'فشل تخزين المرفق' })); }
};
module.exports.config = { api: { bodyParser: false } };
