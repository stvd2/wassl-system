'use strict';
const crypto = require('node:crypto');
const { admin, requireUser } = require('./_auth');
const json = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };
const roles = ['coordinator', 'doctor', 'beds', 'admin'];
const safe = row => ({ id: row.id, tracking_no: row.tracking_no, employee_number: row.employee_number, full_name: row.full_name, mobile: row.mobile, status: row.status, created_at: row.created_at });
function internalEmail(employee) { return `${String(employee).toLowerCase().replace(/[^a-z0-9_.-]/g, '_')}@auth.wassl.invalid`; }
function temporaryPassword() { return `Wsl!${crypto.randomBytes(9).toString('base64url')}`; }
async function existingAuthUser(email) {
  for (let page = 1; page <= 10; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    const users = result.data?.users || [];
    const found = users.find(user => String(user.email || '').toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (users.length < 100) break;
  }
  return null;
}
module.exports = async function handler(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireUser(req, { roles: ['admin'] });
    if (!auth.ok) return json(res, auth.status, { error: auth.error, request_id: requestId });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'method not allowed', request_id: requestId }); }
    const b = req.body || {};
    const id = String(b.id || '');
    const role = String(b.role || '');
    const department = String(b.department || '').trim() || null;
    if (!id || !roles.includes(role)) return json(res, 400, { error: 'الدور أو الطلب غير صالح', request_id: requestId });
    if (role === 'doctor' && !department) return json(res, 400, { error: 'القسم مطلوب للطبيب', request_id: requestId });
    const found = await admin.from('auth_requests').select('*').eq('id', id).eq('status', 'pending').maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return json(res, 404, { error: 'الطلب غير موجود أو تمت معالجته', request_id: requestId });
    const request = found.data;
    const email = internalEmail(request.employee_number);
    const password = String(b.temp_password || '').trim() || temporaryPassword();
    if (password.length < 12) return json(res, 400, { error: 'كلمة المرور المؤقتة يجب ألا تقل عن 12 رمزاً', request_id: requestId });

    let authUser = await existingAuthUser(email);
    if (authUser) {
      const updated = await admin.auth.admin.updateUserById(authUser.id, { password, email_confirm: true, user_metadata: { employee_number: request.employee_number, full_name: request.full_name, mobile: request.mobile } });
      if (updated.error) throw updated.error;
      authUser = updated.data.user;
    } else {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { employee_number: request.employee_number, full_name: request.full_name, mobile: request.mobile } });
      if (created.error) throw created.error;
      authUser = created.data.user;
    }

    const conflict = await admin.from('user_profiles').select('auth_user_id, employee_number').eq('employee_number', request.employee_number).maybeSingle();
    if (conflict.error) throw conflict.error;
    if (conflict.data && conflict.data.auth_user_id !== authUser.id) return json(res, 409, { error: 'رقم الموظف مرتبط بحساب آخر', request_id: requestId });
    const profile = await admin.from('user_profiles').upsert({ auth_user_id: authUser.id, employee_number: request.employee_number, email, full_name: request.full_name, mobile: request.mobile, role, department, active: true, must_change_password: true, password_changed_at: null }, { onConflict: 'auth_user_id' }).select('auth_user_id, employee_number, full_name, mobile, role, department, active, must_change_password, created_at, updated_at').single();
    if (profile.error) throw profile.error;
    const updatedRequest = await admin.from('auth_requests').update({ status: 'approved', reviewed_by: auth.authUser.id, reviewed_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select().single();
    if (updatedRequest.error) throw updatedRequest.error;
    return json(res, 200, { ok: true, user: profile.data, temporary_password: password, request: safe(updatedRequest.data), request_id: requestId });
  } catch (e) {
    console.error('[WASL] /api/auth-requests-approve:', requestId, e.message);
    return json(res, 500, { error: 'تعذر اعتماد الطلب وإنشاء الحساب', request_id: requestId });
  }
};
