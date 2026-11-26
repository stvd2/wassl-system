'use strict';
let appPromise;
function getApp() {
  if (!appPromise) appPromise = import('../../backend/dist/app.js').then(({ createApp }) => createApp());
  return appPromise;
}
module.exports = async function handler(req, res) {
  try { return (await getApp())(req, res); }
  catch (error) { console.error('[WASL v1 adapter]', error); return res.status(500).json({ success: false, error: { code: 'BOOT_ERROR', message: 'تعذر تشغيل Backend v1' } }); }
};
