'use strict';
const crypto = require('node:crypto');
const { admin, requireUser } = require('./_auth');
const json = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };
function validPassword(value, employee) {
  const p = String(value || '');
  if (p.length < 8 || p.length > 128) return 'كلمة المرور يجب أن تكون بين 8 و128 رمزاً';
  if (!/[A-Z]/.test(p)) return 'يجب أن تحتوي كلمة المرور على حرف إنجليزي كبير';
  if (!/[a-z]/.test(p)) return 'يجب أن تحتوي كلمة المرور على حرف إنجليزي صغير';
  if (!/[0-9]/.test(p)) return 'يجب أن تحتوي كلمة المرور على رقم';
  if (/^\s|\s$/.test(p)) return 'لا تبدأ أو تنتهي كلمة المرور بمسافة';
  if (employee && p.toLowerCase().includes(String(employee).toLowerCase())) return 'لا تستخدم رقم الموظف داخل كلمة المرور';
  return '';
}
function temporaryPassword() { return `Wsl!${crypto.randomBytes(9).toString('base64url')}`; }
module.exports = async function handler(req, res) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return json(res, auth.status, { error: auth.error });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'method not allowed' }); }
    const body = req.body || {};
    if (body.action === 'reset_user') {
      if (auth.profile.role !== 'admin') return json(res, 403, { error: 'إعادة تعيين كلمات المرور متاحة لمدير النظام فقط' });
      const userId = String(body.user_id || '');
      if (!userId || userId === auth.authUser.id) return json(res, 400, { error: 'لا يمكن إعادة تعيين كلمة مرور هذا الحساب' });
      const target = await admin.from('user_profiles').select('auth_user_id, employee_number, username, full_name, role, active').eq('auth_user_id', userId).maybeSingle();
      if (target.error) throw target.error;
      if (!target.data) return json(res, 404, { error: 'المستخدم غير موجود' });
      const password = temporaryPassword();
      const updated = await admin.auth.admin.updateUserById(userId, { password });
      if (updated.error) throw updated.error;
      const profile = await admin.from('user_profiles').update({ must_change_password: true, password_changed_at: null }).eq('auth_user_id', userId).select('auth_user_id, employee_number, full_name, mobile, role, department, active, must_change_password, password_changed_at').single();
      if (profile.error) throw profile.error;
      return json(res, 200, { ok: true, temporary_password: password, user: profile.data });
    }
    const password = String(body.password || '');
    const problem = validPassword(password, auth.profile.employee_number);
    if (problem) return json(res, 400, { error: problem });
    const updated = await admin.auth.admin.updateUserById(auth.authUser.id, { password });
    if (updated.error) throw updated.error;
    const profile = await admin.from('user_profiles').update({ must_change_password: false, password_changed_at: new Date().toISOString() }).eq('auth_user_id', auth.authUser.id).select('auth_user_id, employee_number, full_name, mobile, role, department, active, must_change_password, password_changed_at').single();
    if (profile.error) throw profile.error;
    return json(res, 200, { ok: true, user: profile.data });
  } catch (e) {
    console.error('[WASL] /api/password:', e.message);
    return json(res, 500, { error: 'تعذر تحديث كلمة المرور' });
  }
};
