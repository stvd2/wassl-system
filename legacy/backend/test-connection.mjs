// أداة اختبار الاتصال بـ Supabase — التشغيل: node test-connection.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('خطأ: SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY غير معرّفين في .env');
  process.exit(1);
}

console.log('URL:', url);

const supabase = createClient(url, key, { auth: { persistSession: false } });

// 1) هل المشروع قابل للوصول؟
try {
  const h = await fetch(url + '/auth/v1/health');
  console.log('[health]', h.status, await h.text());
} catch (e) {
  console.log('[health] فشل الوصول:', e.message);
}

// 2) هل المفتاح يصلح للاستعلام؟ (إن لم يوجد الجدول بعد فسيظهر "relation does not exist" وهذا طبيعي)
const { data, error } = await supabase.from('app_state').select('id').limit(1);
if (error) {
  console.log('[query] error:', error.code, '-', error.message);
  if (error.code === '42P01') {
    console.log('=> الاتصال والمفتاح يعملان؛ فقط جدول app_state غير موجود بعد (نفّذ database/schema.sql).');
  } else {
    console.log('=> تحقق من المفتاح (service_role/secret) وسياسات الوصول.');
  }
} else {
  console.log('[query] OK:', JSON.stringify(data));
}
