// Vercel Serverless Function — نقطة /api/health (CommonJS)
module.exports = function handler(_req, res) {
  res.status(200).json({ ok: true, service: 'wassl-backend', time: new Date().toISOString() });
};
