# تشغيل Backend v1 باستخدام Docker

## النطاق

هذا الإعداد يبني ويشغّل خدمة `backend/src` فقط. واجهة النظام الحالية ومسارات التوافق القديمة ما زالت تُنشر عبر Vercel؛ لذلك لا يُعد `docker compose up` بديلًا عن نشر الموقع الكامل، ولا يحوّل مسارات Vercel Functions تلقائيًا إلى Express.

تستخدم الخدمة مشروع Supabase قائمًا عبر متغيرات البيئة. لا يوجد Postgres محلي في هذا Compose، ولا يشغّل ترحيلات تلقائيًا. الترحيلات في `database/migrations/` تخص مخطط Supabase، ويجب تطبيقها ومراجعتها عبر مسار ترحيل مستقل قبل اعتمادها، لا عند بدء الحاوية.

## المتطلبات

- Docker مع Docker Compose v2.
- مشروع Supabase مهيأ بترحيلات Wasl المطلوبة.
- `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY`؛ لا تضع المفتاح في الواجهة أو في الصورة أو في Git.

## البدء

```bash
cp .env.example .env
# املأ SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY في .env بمصدر أسرار آمن.
docker compose up --build -d
```

تحقق من صحة الخدمة:

```bash
curl -fsS http://localhost:${BACKEND_PORT:-3001}/api/v1/health
docker compose ps
docker compose logs -f api
```

أوقف الخدمة مع إبقاء الصور المحلية:

```bash
docker compose down
```

## خصائص الأمان والبناء

- صورة تشغيل متعددة المراحل مبنية على Node.js 24 Alpine؛ لا تتضمن أدوات التطوير أو المصدر غير المبني.
- تعمل العملية بمستخدم `node` غير الجذر، مع نظام ملفات للقراءة فقط وإسقاط قدرات Linux.
- لا تُمرر مفاتيح Supabase إلا وقت التشغيل عبر `.env`، ولا تُضمّن في image layers.
- الفحص الصحي محلي لـ `/api/v1/health` ولا يستعلم عن بيانات المرضى.
- تستخدم بيئة الإنتاج على Vercel مسارها الحالي؛ هذا الإعداد مخصص لتشغيل API v1 بصورة منفصلة أو للتحقق من الحاوية.

## CI والنشر

يشغّل GitHub Actions اختبارات المشروع وفحص البناء وصورة Docker على طلبات الدمج وعمليات الدفع إلى `main`. يبقى النشر الإنتاجي للموقع تحت تكامل Vercel المرتبط بالمستودع؛ لا ينشر هذا الـ workflow صورة إلى سجل عام أو يغير إعدادات Vercel.
