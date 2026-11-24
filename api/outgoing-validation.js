'use strict';
const OUTGOING_TYPES = new Set(['عادية', 'عيادات', 'طارئة', 'إنقاذ حياة']);
const ACCEPTANCE_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const ACCEPTANCE_MAX_BYTES = 4 * 1024 * 1024;
function stateError(message, status = 400) { const error = new Error(message); error.statusCode = status; return error; }
function validateOutgoingState(value) {
  if (!Array.isArray(value?.outgoing_referrals)) return;
  const numbers = new Set();
  for (const item of value.outgoing_referrals) {
    if (!item || typeof item !== 'object' || !/^[A-Za-z0-9_-]{1,160}$/.test(String(item.id || ''))) throw stateError('بيانات إحالة الصادر غير صالحة');
    if (!OUTGOING_TYPES.has(String(item.case_type || ''))) throw stateError('نوع حالة الصادر غير صالح');
    if (item.case_type === 'إنقاذ حياة' && !String(item.ministerial_code || '').trim()) throw stateError('الكود الوزاري إلزامي لحالات إنقاذ الحياة');
    const ministerial = String(item.ministerial_ref_no || '').trim();
    if (ministerial) { if (ministerial.length > 120) throw stateError('رقم الإحالة الوزاري طويل جداً'); const key = ministerial.toLowerCase(); if (numbers.has(key)) throw stateError('رقم الإحالة الوزاري مكرر'); numbers.add(key); }
    const attachmentId = String(item.acceptance_letter_attachment_id || '').trim();
    if (attachmentId) {
      const meta = value.attachments && value.attachments[attachmentId];
      if (!meta || meta.category !== 'acceptance_letter' || String(meta.referral_id) !== String(item.id)) throw stateError('خطاب القبول غير مرتبط بالإحالة بشكل صحيح');
      if (!ACCEPTANCE_MIME.has(String(meta.mime_type || meta.type || '').toLowerCase())) throw stateError('نوع خطاب القبول غير مسموح');
      const size = Number(meta.size); if (!Number.isFinite(size) || size <= 0 || size > ACCEPTANCE_MAX_BYTES) throw stateError('حجم خطاب القبول غير صالح');
      if (!String(meta.uploaded_by || '').trim() || !meta.uploaded_at) throw stateError('بيانات رافع خطاب القبول ناقصة');
    }
  }
}
module.exports = { validateOutgoingState, ACCEPTANCE_MIME, ACCEPTANCE_MAX_BYTES };
