// Vercel Serverless Function — نقطة /api/health
export default function handler(_req, res) {
  res.status(200).json({ ok: true, service: 'wassl-backend', time: new Date().toISOString() });
}
