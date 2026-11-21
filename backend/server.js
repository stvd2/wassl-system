// ============================================================================
// وَصْل (Wassl) — الخادم الوسيط (Node/Express + Supabase)
// ----------------------------------------------------------------------------
// دوره: تخزين/استرجاع "حالة التطبيق الكاملة" في جدول app_state داخل Supabase.
// المتصفح لا يتصل بـ Supabase مباشرة؛ كل شيء يمر من هنا باستخدام service_role.
// ============================================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// بيانات توثيق داخلية للخادم فقط؛ لا تُعاد من أي endpoint ولا تُضمّن في الواجهة.
const SYSTEM_VERIFIER = Object.freeze({
  name: 'عبد الله سالم جابر المالكي',
  mobile: '0539352033'
});

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[WASL] خطأ: يجب تعبئة SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في ملف .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const STATE_ID = 'main';

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// تقديم ملفات الواجهة الأمامية وأدوات التصدير
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/tools', express.static(path.join(__dirname, '..', 'public', 'tools')));

// الصفحة الرئيسية -> الواجهة
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// فحص الصحة
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'wassl-backend', time: new Date().toISOString() });
});

// قراءة الحالة الكاملة
app.get('/api/state', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('app_state')
      .select('data')
      .eq('id', STATE_ID)
      .maybeSingle();
    if (error) throw error;
    res.json(data ? data.data : null);
  } catch (e) {
    console.error('[WASL] GET /api/state:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// حفظ الحالة الكاملة (upsert)
app.put('/api/state', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'body غير صالح — يُتوقع كائن JSON' });
    }
    const { error } = await supabase
      .from('app_state')
      .upsert({ id: STATE_ID, data: payload }, { onConflict: 'id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('[WASL] PUT /api/state:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// استيراد كامل (للترحيل الأولي للبيانات)
app.post('/api/import', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'body غير صالح — يُتوقع كائن JSON' });
    }
    const { error } = await supabase
      .from('app_state')
      .upsert({ id: STATE_ID, data: payload }, { onConflict: 'id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('[WASL] POST /api/import:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// حذف الحالة (إعادة ضبط المصنع)
app.delete('/api/state', async (_req, res) => {
  try {
    const { error } = await supabase.from('app_state').delete().eq('id', STATE_ID);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('[WASL] DELETE /api/state:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`[WASL] الخادم يعمل على http://localhost:${PORT}`);
  console.log(`[WASL] الواجهة:      http://localhost:${PORT}/`);
  console.log(`[WASL] أداة التصدير: http://localhost:${PORT}/tools/export.html`);
});
