'use strict';
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function cookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((out, item) => {
    const i = item.indexOf('=');
    if (i > 0) out[item.slice(0, i).trim()] = decodeURIComponent(item.slice(i + 1).trim());
    return out;
  }, {});
}
function bearer(req) {
  const value = String(req.headers.authorization || '');
  if (/^Bearer\s+\S+$/i.test(value)) return value.replace(/^Bearer\s+/i, '');
  return cookies(req).wasl_access_token || '';
}
function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
async function requireUser(req, options = {}) {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: 'يلزم تسجيل الدخول' };
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user) return { ok: false, status: 401, error: 'جلسة الدخول غير صالحة أو منتهية' };
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('auth_user_id, employee_number, role, department, active, full_name, email')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.active !== true) return { ok: false, status: 403, error: 'الحساب غير مفعل' };
  if (options.roles && !options.roles.includes(profile.role)) return { ok: false, status: 403, error: 'لا تملك صلاحية هذه العملية' };
  return { ok: true, authUser: authData.user, profile };
}
module.exports = { admin, bearer, cookies, requireUser, setCookie, clearCookie };
