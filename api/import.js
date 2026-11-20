// Vercel Serverless Function — نقطة /api/import (POST) للترحيل الأولي
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const STATE_ID = 'main';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'body غير صالح' });
    }
    const { error } = await supabase
      .from('app_state')
      .upsert({ id: STATE_ID, data: payload }, { onConflict: 'id' });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[WASL] /api/import:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
