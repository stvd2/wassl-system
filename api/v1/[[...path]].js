'use strict';
const serverless = require('serverless-http');
let handlerPromise;
function getHandler() {
  if (!handlerPromise) handlerPromise = import('../../backend/dist/app.js').then(({ createApp }) => serverless(createApp()));
  return handlerPromise;
}
module.exports = async function handler(req, res) {
  try { return (await getHandler())(req, res); }
  catch (error) { console.error('[WASL v1 adapter]', error); return res.status(500).json({ success: false, error: { code: 'BOOT_ERROR', message: 'تعذر تشغيل Backend v1' } }); }
};
