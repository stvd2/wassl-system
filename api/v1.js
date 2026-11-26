'use strict';
let appPromise;
function getApp() {
  if (!appPromise) appPromise = import('../backend/dist/app.js').then(({ createApp }) => createApp());
  return appPromise;
}
function restoreExpressPath(req) {
  const parsed = new URL(req.url || '/', 'http://localhost');
  const route = parsed.searchParams.get('__route');
  if (route === null) return;
  parsed.searchParams.delete('__route');
  const suffix = route.replace(/^\/+/, '');
  const query = parsed.searchParams.toString();
  req.url = `/api/v1${suffix ? `/${suffix}` : ''}${query ? `?${query}` : ''}`;
}
module.exports = async function handler(req, res) {
  try {
    restoreExpressPath(req);
    return (await getApp())(req, res);
  } catch (error) {
    console.error('[WASL v1 adapter]', error);
    return res.status(500).json({ success: false, error: { code: 'BOOT_ERROR', message: 'تعذر تشغيل Backend v1' } });
  }
};
