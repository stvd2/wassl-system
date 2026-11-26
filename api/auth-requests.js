'use strict';
const crypto = require('node:crypto');
const { admin, requireUser } = require('./_auth');
const approveHandler = require('./_auth-requests-approve');

const json = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };
const normalizeMobile = v => String(v || '').replace(/[\s-]/g, '');
const validEmployee = v => /^[A-Za-z0-9_.-]{3,30}$/.test(v);
const validMobile = v => /^05\d{8}$/.test(v);
function trackingNo() { return `REQ-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function publicRequest(row) { return { id: row.id, tracking_no: row.tracking_no, employee_number: row.employee_number, full_name: row.full_name, mobile: row.mobile, status: row.status, rejection_reason: row.rejection_reason, created_at: row.created_at, reviewed_at: row.reviewed_at }; }
module.exports = async function handler(req, res) {
  if (req.query?.action === 'approve') return approveHandler(req, res);
  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      const forwardedIp = String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const rateKey = crypto.createHash('sha256').update(forwardedIp).digest('hex');
      const rate = await admin.rpc('wasl_consume_rate_limit', { p_key_hash: rateKey, p_limit: 5, p_window_seconds: 900 });
      if (rate.error) throw rate.error;
      if (rate.data !== true) return json(res, 429, { error: 'تم تجاوز عدد محاولات التسجيل. حاول بعد 15 دقيقة.' });
      const employee_number = String(b.employee_number || '').trim();
      const full_name = String(b.full_name || '').trim();
      const mobile = normalizeMobile(b.mobile);
      if (!validEmployee(employee_number)) return json(res, 400, { error: 'رقم الموظف يجب أن يكون من 3 إلى 30 حرفاً أو رقماً' });
      if (full_name.length < 3 || full_name.length > 160) return json(res, 400, { error: 'الاسم الكامل غير صالح' });
      if (!validMobile(mobile)) return json(res, 400, { error: 'رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام' });
      const existing = await admin.from('user_profiles').select('employee_number').eq('employee_number', employee_number).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) return json(res, 409, { error: 'رقم الموظف مسجل مسبقاً' });
      const pending = await admin.from('auth_requests').select('id').eq('employee_number', employee_number).eq('status', 'pending').maybeSingle();
      if (pending.error) throw pending.error;
      if (pending.data) return json(res, 409, { error: 'يوجد طلب معلق لهذا الرقم الوظيفي' });
      const mobileTaken = await admin.from('user_profiles').select('auth_user_id').eq('mobile', mobile).maybeSingle();
      if (mobileTaken.error) throw mobileTaken.error;
      if (mobileTaken.data) return json(res, 409, { error: 'رقم الجوال مسجل مسبقاً' });
      const row = await admin.from('auth_requests').insert({ tracking_no: trackingNo(), employee_number, full_name, mobile }).select().single();
      if (row.error) {
        if (row.error.code === '23505') return json(res, 409, { error: 'يوجد طلب أو حساب مسجل بهذه البيانات مسبقاً' });
        throw row.error;
      }
      const notification = await admin.rpc('wasl_append_auth_notification', { p_request_id: row.data.id, p_full_name: full_name, p_employee_number: employee_number, p_tracking_no: row.data.tracking_no });
      if (notification.error) {
        await admin.from('auth_requests').delete().eq('id', row.data.id).eq('status', 'pending');
        throw notification.error;
      }
      return json(res, 201, { ok: true, request: publicRequest(row.data) });
    }
    const auth = await requireUser(req, { roles: ['admin'] });
    if (!auth.ok) return json(res, auth.status, { error: auth.error });
    if (req.method === 'GET') {
      const result = await admin.from('auth_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(1000);
      if (result.error) throw result.error;
      return json(res, 200, { requests: result.data.map(publicRequest) });
    }
    if (req.method === 'PATCH') {
      const b = req.body || {};
      const id = String(b.id || '');
      const status = String(b.status || '');
      if (!id || !['rejected'].includes(status)) return json(res, 400, { error: 'طلب غير صالح' });
      const result = await admin.from('auth_requests').update({ status, rejection_reason: String(b.reason || '').slice(0, 500), reviewed_by: auth.authUser.id, reviewed_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select().single();
      if (result.error) throw result.error;
      if (!result.data) return json(res, 404, { error: 'الطلب غير موجود أو تمت معالجته' });
      return json(res, 200, { ok: true, request: publicRequest(result.data) });
    }
    res.setHeader('Allow', 'GET, POST, PATCH');
    return json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    console.error('[WASL] /api/auth-requests:', e.message);
    return json(res, 500, { error: 'تعذر معالجة طلب التسجيل' });
  }
};
