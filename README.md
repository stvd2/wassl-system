# نظام وَصْل (Wasl) v1.1

نظام إدارة الإحالات الطبية، مبني وفق المواصفة المعتمدة في `docs/wasl-spec-v1.1.md`.

## الهيكل الحالي

```text
frontend/       مساحة واجهة v1 العربية RTL
backend/src/    Backend v1 الطبقي TypeScript/Express
api/            محولات Vercel ومسارات التوافق وv1
legacy/         نسخة النظام القديم المعزولة مؤقتًا
 database/      ترحيلات Supabase العلائقية
 tests/          اختبارات الأمن والعقود والتكامل
 docs/           المواصفة وخطط وتقارير التدقيق
```

المصدر التشغيلي لـ v1 هو الجداول العلائقية في Supabase وواجهات `/api/v1`. لا يقرأ Backend v1 `app_state` أو `user_profiles`. تبقى ملفات `legacy/` ومسارات `/api/state` محفوظة مؤقتًا للتوافق والرجوع، ولا يجوز تطوير ميزات جديدة عليها.

## تشغيل Backend v1 محليًا

```bash
cd backend
cp .env.example .env
npm install
npm run typecheck
npm run build
npm start
```

نقطة التشغيل المحلية هي `http://localhost:3001`، وتتوفر مسارات:

- `GET /api/v1/health`
- `GET /api/v1/health/deep`
- `GET /api/v1/metrics`
- `GET /api/v1/referrals` مع Bearer JWT
- `POST /api/v1/referrals` للمنسق أو المدير
- `POST /api/v1/referrals/:id/transitions`

## الاختبارات

من جذر المستودع:

```bash
npm install
npm --prefix backend ci
npm test
npm run backend:build
```

## النشر

يستخدم Vercel `buildCommand` لبناء Backend v1، وتوجه rewrites مسارات `/health` و`/health/deep` و`/api/metrics` إلى تطبيق v1. يحدد `engines.node` إصدار Node.js 24.x المدعوم للبناء والدوال. يجب تطبيق ترحيلات `database/migrations` على Supabase قبل اعتماد المسارات الجديدة في الإنتاج.

## تشغيل Backend v1 باستخدام Docker

يوفر `docker compose up --build` حاوية مستقلة لـ Backend v1 تتصل بمشروع Supabase موجود. لا يشغّل Compose قاعدة بيانات محلية أو ترحيلات تلقائية، ولا يستبدل نشر الواجهة ومسارات Vercel الحالية. راجع [دليل Docker](docs/docker.md) للمتطلبات وحدود التشغيل.

## الترحيلات والبيانات

الترحيل `017_wasl_v1_1_relational_core.sql` ينشئ النموذج العلائقي الأساسي دون حذف legacy. الترحيل `018_wasl_v1_1_workflow_hardening.sql` يضيف مصفوفة الانتقالات ومولد الرقم المرجعي ودالة الانتقال الجديدة. ترحيل البيانات من `app_state` إلى الجداول العلائقية عملية مستقلة ولا تحذف المصدر القديم.
