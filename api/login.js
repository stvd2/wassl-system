'use strict';
const { createClient } = require('@supabase/supabase-js');
const { admin, cookies, profileFor, setCookie, clearCookie } = require('./_auth');
const clientKey = process.env.SUPABASE_CLIENT_KEY || '';
const client = clientKey ? createClient(process.env.SUPABASE_URL, clientKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const json = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };
function internalEmail(employee) { return `${String(employee).toLowerCase().replace(/[^a-z0-9_.-]/g, '_')}@auth.wassl.invalid`; }
function sessionCookies(res, session) { res.setHeader('Set-Cookie', [setCookie('wasl_access_token', session.access_token, Math.max(60, session.expires_in || 3600)), setCookie('wasl_refresh_token', session.refresh_token, 60 * 60 * 24 * 30)]); }
async function signIn(email, password) { return client.auth.signInWithPassword({ email, password }); }
module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const username = String((req.body || {}).username || '').trim();
      const password = String((req.body || {}).password || '');
      if (!username || !password) return json(res, 400, { error: 'رقم الموظف وكلمة المرور مطلوبان' });
      if (!client) return json(res, 503, { error: 'مصادقة Supabase غير مهيأة على الخادم' });
      const found = await admin.from('user_profiles').select('auth_user_id, email, employee_number, active').eq('employee_number', username).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data || found.data.active !== true) return json(res, 401, { error: 'بيانات الدخول غير صحيحة' });
      const candidates = [internalEmail(found.data.employee_number), found.data.email].filter((v, i, a) => v && a.indexOf(v) === i);
      let data = null;
      for (const email of candidates) {
        const result = await signIn(email, password);
        if (!result.error && result.data?.session) { data = result.data; break; }
      }
      if (!data?.session) return json(res, 401, { error: 'بيانات الدخول غير صحيحة' });
      const profile = await profileFor(data.user.id);
      if (!profile?.active) return json(res, 403, { error: 'الحساب غير مفعل' });
      sessionCookies(res, data.session);
      return json(res, 200, { ok: true, user: profile });
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
    if (req.method === 'DELETE') { res.setHeader('Set-Cookie', [clearCookie('wasl_access_token'), clearCookie('wasl_refresh_token')]); return json(res, 200, { ok: true }); }
    res.setHeader('Allow', 'GET, POST, DELETE'); return json(res, 405, { error: 'method not allowed' });
  } catch (error) { console.error('[WASL] /api/login:', error.message); return json(res, 500, { error: 'تعذر إتمام عملية المصادقة' }); }
};
