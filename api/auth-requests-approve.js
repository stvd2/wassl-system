'use strict';
const crypto = require('node:crypto');
const { admin, requireUser } = require('./_auth');
const json = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };
const roles = ['coordinator', 'doctor', 'beds', 'admin'];
const safe = row => ({ id: row.id, tracking_no: row.tracking_no, employee_number: row.employee_number, full_name: row.full_name, mobile: row.mobile, status: row.status, created_at: row.created_at });
function internalEmail(employee) { return `${employee.toLowerCase().replace(/[^a-z0-9_.-]/g, '_')}@auth.wassl.invalid`; }
function temporaryPassword() { return `Wsl!${crypto.randomBytes(9).toString('base64url')}`; }
module.exports = async function handler(req, res) {
  try {
    const auth = await requireUser(req, { roles: ['admin'] });
    if (!auth.ok) return json(res, auth.status, { error: auth.error });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'method not allowed' }); }
    const b = req.body || {};
    const id = String(b.id || '');
    const role = String(b.role || '');
    const department = String(b.department || '').trim() || null;
    if (!id || !roles.includes(role)) return json(res, 400, { error: 'الدور أو الطلب غير صالح' });
    if (role === 'doctor' && !department) return json(res, 400, { error: 'القسم مطلوب للطبيب' });
    const found = await admin.from('auth_requests').select('*').eq('id', id).eq('status', 'pending').maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return json(res, 404, { error: 'الطلب غير موجود أو تمت معالجته' });
    const request = found.data;
    const password = String(b.temp_password || '').trim() || temporaryPassword();
    if (password.length < 12) return json(res, 400, { error: 'كلمة المرور المؤقتة يجب ألا تقل عن 12 رمزاً' });
    const created = await admin.auth.admin.createUser({ email: internalEmail(request.employee_number), password, email_confirm: true, user_metadata: { employee_number: request.employee_number, full_name: request.full_name, mobile: request.mobile } });
    if (created.error) throw created.error;
    const profile = await admin.from('user_profiles').insert({ auth_user_id: created.data.user.id, employee_number: request.employee_number, email: internalEmail(request.employee_number), full_name: request.full_name, mobile: request.mobile, role, department, active: true, must_change_password: true, password_changed_at: null }).select('auth_user_id, employee_number, full_name, mobile, role, department, active, must_change_password, created_at, updated_at').single();
    if (profile.error) { await admin.auth.admin.deleteUser(created.data.user.id); throw profile.error; }
    const updated = await admin.from('auth_requests').update({ status: 'approved', reviewed_by: auth.authUser.id, reviewed_at: new Date().toISOString() }).eq('id', id).select().single();
    if (updated.error) throw updated.error;
    return json(res, 200, { ok: true, user: profile.data, temporary_password: password, request: safe(updated.data) });
  } catch (e) {
    console.error('[WASL] /api/auth-requests-approve:', e.message);
    return json(res, 500, { error: 'تعذر اعتماد الطلب وإنشاء الحساب' });
  }
};
