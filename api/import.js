// Vercel Serverless Function — نقطة /api/import (POST) — CommonJS
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const STATE_ID = 'main';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'body غير صالح' });
    }
    const expectedRevision = Number.isInteger(payload?.meta?.sync_revision) && payload.meta.sync_revision >= 0 ? payload.meta.sync_revision : 0;
    const { data: result, error } = await supabase.rpc('save_app_state', {
      expected_revision: expectedRevision,
      next_data: payload
    });
    if (error) throw error;
    if (!result?.ok) return res.status(409).json({ error: 'تعارض مزامنة: توجد نسخة أحدث على جهاز آخر', conflict: true });
    return res.status(200).json({ ok: true, data: result.data, revision: result.revision });
  } catch (e) {
    console.error('[WASL] /api/import:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
