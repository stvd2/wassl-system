'use strict';
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
module.exports = async function handler(req, res) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return json(res, auth.status, { error: auth.error });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'method not allowed' }); }
    const password = String((req.body || {}).password || '');
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
