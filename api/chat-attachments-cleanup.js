'use strict';

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireUser } = require('./_auth');

const STATE_ID = 'main';
const BUCKET = 'attachments';
const MAX_BODY = 256 * 1024;
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
  if (req.body && typeof req.body === 'object') return req.body;
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

function canonicalHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data), 'utf8').digest('hex');
}

function chatAttachmentIds(data) {
  const ids = new Set();
  for (const chat of Array.isArray(data?.chats) ? data.chats : []) {
    for (const message of Array.isArray(chat.messages) ? chat.messages : []) {
      for (const id of Array.isArray(message.atts) ? message.atts : []) {
        if (/^[A-Za-z0-9_-]{1,120}$/.test(String(id))) ids.add(String(id));
      }
    }
  }
  for (const [id, meta] of Object.entries(data?.attachments || {})) {
    if (String(meta?.referral_id || '').startsWith('chat-') && /^[A-Za-z0-9_-]{1,120}$/.test(id)) ids.add(id);
  }
  return [...ids].sort();
}

function chunk(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method not allowed' });
  }

  try {
    const body = await readJson(req);
    if (body.action !== 'cleanup_chat_attachments' || body.confirmed !== true || body.backupConfirmed !== true) {
      return send(res, 400, { error: 'يلزم تأكيد نطاق التنظيف والنسخة الاحتياطية' });
    }
    const auth = await requireUser(req, { roles: ['admin'] });
    if (!auth.ok) return send(res, auth.status, { error: auth.error });

    const { data: row, error: readError } = await supabase.from('app_state').select('data').eq('id', STATE_ID).maybeSingle();
    if (readError) throw readError;
    const current = row?.data;
    if (!current?.meta || current.meta.version !== 'v6') return send(res, 500, { error: 'حالة النظام غير صالحة' });
    const revision = Number(current.meta.sync_revision || 0);
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== revision) {
      return send(res, 409, { error: 'تغيرت الحالة؛ نفّذ مزامنة ثم أنشئ نسخة احتياطية جديدة', revision });
    }
    const currentHash = canonicalHash(current);
    if (body.backupHash !== currentHash) return send(res, 409, { error: 'النسخة الاحتياطية لا تطابق الحالة الحالية؛ أعد إنشاءها' });

    const ids = chatAttachmentIds(current);
    const requested = Array.isArray(body.attachmentIds) ? [...new Set(body.attachmentIds.map(String))].sort() : [];
    if (JSON.stringify(ids) !== JSON.stringify(requested)) {
      return send(res, 409, { error: 'نطاق الملفات تغير؛ لم ينفذ الحذف', count: ids.length });
    }
    if (!ids.length) return send(res, 200, { ok: true, deleted: 0, failed: 0, revision, data: current, message: 'لا توجد مرفقات محادثات للتنظيف' });

    const deleted = [];
    const failed = [];
    for (const group of chunk(ids, 100)) {
      const { data: removed, error } = await supabase.storage.from(BUCKET).remove(group);
      if (error) {
        failed.push(...group);
      } else {
        const removedSet = new Set((removed || []).map(item => String(item.name || item.id || '')));
        for (const id of group) {
          if (!removedSet.size || removedSet.has(id)) deleted.push(id);
          else failed.push(id);
        }
      }
    }

    const next = JSON.parse(JSON.stringify(current));
    for (const id of deleted) delete next.attachments[id];
    next.meta = { ...(next.meta || {}), local_updated_at: new Date().toISOString() };
    const { data: saved, error: saveError } = await supabase.rpc('save_app_state', {
      expected_revision: revision,
      next_data: next
    });
    if (saveError) throw saveError;
    if (!saved?.ok) return send(res, 409, { error: 'تعذر حفظ نتيجة التنظيف بسبب تعارض مزامنة', deleted: deleted.length, failed: failed.length });

    return send(res, 200, {
      ok: true,
      deleted: deleted.length,
      failed: failed.length,
      deletedIds: deleted,
      failedIds: failed,
      scope: 'chat_attachments_only',
      messagesPreserved: true,
      usersPreserved: true,
      data: saved.data,
      revision: saved.revision
    });
  } catch (error) {
    console.error('[WASL] /api/chat-attachments-cleanup:', error.message);
    return send(res, error.statusCode || 500, { error: 'فشل تنظيف مرفقات المحادثات' });
  }
};
