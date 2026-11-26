# خطة إعادة هيكلة نظام وَصْل v1.1

## الهدف
تحويل المستودع من تطبيق legacy يعتمد على `app_state` ودوال Vercel المتفرقة إلى بنية واضحة تفصل واجهة المستخدم عن Backend v1 والخدمات والمستودع العلائقي، مع إبقاء المسارات القديمة في طبقة توافق مؤقتة وعدم حذف البيانات.

## البنية المستهدفة

```text
frontend/                 واجهة v1 ومكونات RTL
backend/
  src/
    config/               إعداد البيئة وSupabase
    middleware/           request-id وJWT وRBAC ومعالجة الأخطاء
    routes/               auth وreferrals وhealth
    controllers/          تحويل HTTP إلى خدمات
    services/             منطق الأعمال والانتقالات
    repositories/         الوصول إلى الجداول العلائقية فقط
    validators/           التحقق من المدخلات
    types/                نماذج المجال
    app.ts                تركيب Express
    server.ts             نقطة تشغيل الخادم
database/
  migrations/             ترحيلات schema وworkflow وoutbox
legacy/
  api/                    نسخة المسارات القديمة للتوافق
  backend/                الخادم القديم
  public/                 الواجهة القديمة
api/                      محولات Vercel ومسارات التوافق/v1
public/                   مدخل ثابت مؤقت للتوافق والنشر الحالي
tests/
  unit/                   اختبارات الخدمات والتحقق
  integration/            اختبارات HTTP والعقود
  security/               اختبارات RLS وRBAC والعقود الأمنية
docs/                     المواصفة وتقارير التدقيق
```

## قواعد التنفيذ

1. لا تُحذف `app_state` أو ملفات legacy؛ تنقل إلى `legacy/` أو تبقى خلف محولات توافق.
2. لا يقرأ Backend v1 `app_state` أو `user_profiles`؛ مصدره جداول v1 العلائقية.
3. كل استجابة v1 تستخدم `success/data/meta` أو `success:false/error` وتضيف `X-Request-Id`.
4. كل انتقال يمر بخدمة واحدة ويستخدم `expected_status` و`expected_version` و`Idempotency-Key`.
5. لا يتم نشر أو اعتماد Backend v1 قبل نجاح build وtypecheck والاختبارات والعقود.
6. أي ترحيل بيانات من legacy إلى v1 يكون منفصلًا، قابلًا لإعادة التشغيل، ولا يحذف المصدر.

## مراحل التنفيذ

- المرحلة 1: إنشاء الهيكل والحدود البرمجية وطبقة التوافق.
- المرحلة 2: تنفيذ Backend v1 الأساسي: health/auth/referrals/transitions.
- المرحلة 3: استكمال الأسرة والمرفقات والإشعارات والمحادثات والتقارير.
- المرحلة 4: تحديث قاعدة البيانات والاختبارات وCI والنشر.
- المرحلة 5: ترحيل البيانات والتحقق ثم نافذة قطع legacy.
