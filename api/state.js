// Vercel Serverless Function — نقطة /api/state (GET/PUT/DELETE) — CommonJS
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const STATE_ID = 'main';

module.exports = async function handler(req, res) {
  const { method } = req;
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (method === 'GET') {
      const { data, error } = await supabase
        .from('app_state')
        .select('data')
        .eq('id', STATE_ID)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json(data ? data.data : null);
    }
    if (method === 'PUT' || method === 'POST') {
      const payload = req.body;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return res.status(400).json({ error: 'body غير صالح' });
      }
      const { error } = await supabase
        .from('app_state')
        .upsert({ id: STATE_ID, data: payload }, { onConflict: 'id' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    if (method === 'DELETE') {
      const { error } = await supabase.from('app_state').delete().eq('id', STATE_ID);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('[WASL] /api/state:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
