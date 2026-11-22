'use strict';
const { createClient } = require('@supabase/supabase-js');
const { admin, cookies, setCookie, clearCookie } = require('./_auth');

const clientKey = process.env.SUPABASE_CLIENT_KEY || '';
const client = clientKey ? createClient(process.env.SUPABASE_URL, clientKey, {
  auth: { persistSession: false, autoRefreshToken: false }
}) : null;
const json = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };
function sessionCookies(res, session) {
  res.setHeader('Set-Cookie', [
    setCookie('wasl_access_token', session.access_token, Math.max(60, session.expires_in || 3600)),
    setCookie('wasl_refresh_token', session.refresh_token, 60 * 60 * 24 * 30)
  ]);
}
async function profileFor(userId) {
  const { data, error } = await admin.from('user_profiles')
    .select('auth_user_id, employee_number, role, department, active, full_name, email')
    .eq('auth_user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) return json(res, 400, { error: 'اسم المستخدم وكلمة المرور مطلوبان' });
      if (!client) return json(res, 503, { error: 'مصادقة Supabase غير مهيأة على الخادم' });
      const { data: profile, error: profileError } = await admin.from('user_profiles')
        .select('auth_user_id, email, active').eq('employee_number', username).maybeSingle();
      if (profileError) throw profileError;
      if (!profile?.email || profile.active !== true) return json(res, 401, { error: 'بيانات الدخول غير صحيحة' });
      const { data, error } = await client.auth.signInWithPassword({ email: profile.email, password });
      if (error || !data?.session) return json(res, 401, { error: 'بيانات الدخول غير صحيحة' });
      const fullProfile = await profileFor(data.user.id);
      if (!fullProfile?.active) return json(res, 403, { error: 'الحساب غير مفعل' });
      sessionCookies(res, data.session);
      return json(res, 200, { ok: true, user: fullProfile });
    }
    if (req.method === 'GET') {
      const access = cookies(req).wasl_access_token;
      if (!access) return json(res, 401, { authenticated: false });
      const { data: authData, error } = await admin.auth.getUser(access);
      if (error || !authData?.user) return json(res, 401, { authenticated: false });
      const profile = await profileFor(authData.user.id);
      if (!profile?.active) return json(res, 403, { authenticated: false });
      return json(res, 200, { authenticated: true, user: profile });
    }
    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', [clearCookie('wasl_access_token'), clearCookie('wasl_refresh_token')]);
      return json(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return json(res, 405, { error: 'method not allowed' });
  } catch (error) {
    console.error('[WASL] /api/login:', error.message);
    return json(res, 500, { error: 'تعذر إتمام عملية المصادقة' });
  }
};
