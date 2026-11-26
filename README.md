# نظام وَصْل (Wassl)

نظام إدارة الإحالات الطبية — متصل بقاعدة بيانات **Supabase**.

يدعم وضعين للتشغيل:
- **محلياً** عبر خادم Node/Express (`backend/`).
- **منشوراً على Vercel** عبر Serverless Functions (`api/`).

## البنية

```
wassl-system/
├── public/          → الواجهة الثابتة (index.html + tools/export.html)
├── api/             → دوال Vercel serverless (/api/state, /api/import, /api/health)
├── backend/         → خادم Node/Express للتشغيل المحلي
├── database/        → schema.sql (مخطط قاعدة البيانات)
├── backup/          → نسخة احتياطية من الملف الأصلي
├── package.json     → تبعيات دوال Vercel
└── .gitignore
```

## المتطلبات

- Node.js v18 أو أحدث.
- مشروع Supabase جاهز (Project URL + المفتاح السري `sb_secret_...` / `service_role`).

## إعداد قاعدة البيانات (مرة واحدة)

افتح Supabase ← `SQL Editor` ← الصق محتوى `database/schema.sql` كاملاً ← `Run`.

## التشغيل المحلي

```bash
cd backend
copy .env.example .env     # عبّئ SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY
npm install
npm start
```
ثم افتح المتصفح على: **http://localhost:3001**

## النشر على Vercel

1. ارفع المشروع إلى مستودع GitHub.
2. في [Vercel](https://vercel.com): **Add New → Project → Import Git Repository** ← اختر المستودع.
3. أضف متغيري البيئة في **Settings → Environment Variables**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. اضغط **Deploy**. Vercel يكتشف `public/` (الملفات الثابتة) و `api/` (الدوال) تلقائياً.

## ترحيل البيانات الحالية (من localStorage)

- **تلقائياً:** عند أول فتح للتطبيق بعد التوصيل، إن لم يجد الخادم بيانات ووجد نسخة محلية، يرفعها إلى Supabase تلقائياً.
- **يدوياً:** افتح `tools/export.html` (محلياً) أو `https://your-app.vercel.app/tools/export.html` واضغط «إرسال البيانات إلى الخادم».

## كيف يعمل الاتصال

- الواجهة تحتفظ بنسخة محلية في `localStorage` كذاكرة مؤقتة، وSupabase هو **المصدر الأساسي**.
- الوصول إلى Supabase يتم **حصرياً عبر الخادم/الدوال** باستخدام المفتاح السري؛ المتصفح لا يحمل أي مفتاح Supabase.
- نقاط النهاية: `GET/PUT/DELETE /api/state` و `POST /api/import` و `GET /api/health`.

## ملاحظات أمنية (للإنتاج)

- هذا الإعداد يصلح للتشغيل الداخلي/التجريبي. للإنتاج يُفضَّل: مصادقة فعلية عبر Supabase Auth، نموذج علائقي بجداول منفصلة مع RLS لكل دور، وHTTPS (Vercel يوفّر HTTPS تلقائياً).
- لا ترفع ملف `.env` (يحتوي المفتاح السري) إلى أي مستودع عام.

## مرجع v1.1 المعتمد

التنفيذ الجديد لنظام وَصْل يعتمد حصريًا على `docs/wasl-spec-v1.1.md`، وهي نسخة المستند المرفق المعتمد. تم حفظ النسخة السابقة قبل التكامل عبر tag `pre-spec-integration-20261127` والفرع `archive/pre-spec-main`.

الترحيل العلائقي غير التدميري موجود في `database/migrations/017_wasl_v1_1_relational_core.sql`. لا يحذف هذا الترحيل `app_state` ولا أي بيانات طبية؛ بل يضيف نموذج v1.1 وسياسة انتقال موحدة. المسارات القديمة، بما فيها `/api/state`، مجمدة للتوافق ولا يجوز استخدامها كمصدر حقيقة جديد.
