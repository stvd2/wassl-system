'use strict';

const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return /^Bearer\s+\S+$/i.test(value) ? value.replace(/^Bearer\s+/i, '') : '';
}

/**
 * Verify the access token with Supabase Auth, then load the application role
 * from user_profiles. Never use getSession() or client-supplied role claims
 * for authorization decisions.
 */
async function requireUser(req, options = {}) {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: 'يلزم تسجيل الدخول' };
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user) return { ok: false, status: 401, error: 'جلسة الدخول غير صالحة أو منتهية' };
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('auth_user_id, employee_number, role, department, active, full_name')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.active !== true) return { ok: false, status: 403, error: 'الحساب غير مفعل' };
  if (options.roles && !options.roles.includes(profile.role)) return { ok: false, status: 403, error: 'لا تملك صلاحية هذه العملية' };
  return { ok: true, authUser: authData.user, profile };
}

module.exports = { admin, bearer, requireUser };
