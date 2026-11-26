# Wasl v1.1 — إعادة الهيكلة والتنفيذ

## الهيكل والحدود

- [ ] إنشاء `frontend/` لواجهة v1 مع RTL وعدم ربطها بـ `app_state`.
- [ ] إنشاء `backend/src/` مع config وmiddleware وroutes وcontrollers وservices وrepositories وvalidators وtypes.
- [ ] عزل الكود القديم في `legacy/` مع إبقاء محولات التوافق خلال فترة الانتقال.
- [ ] توثيق نقطة تشغيل واحدة للـ Backend v1 وعدم تشغيل الخادم القديم كخادم v1.

## API v1

- [ ] توفير `/api/v1/health` و`/api/v1/health/deep` و`/api/v1/metrics`.
- [ ] توفير `/api/v1/auth/login` و`/api/v1/auth/logout` و`/api/v1/auth/me`.
- [ ] توفير مسارات المستخدمين حسب RBAC.
- [ ] توفير CRUD الإحالات فوق `referrals` فقط مع pagination.
- [ ] توفير الأحداث والانتقالات باستخدام `expected_status` و`version` و`Idempotency-Key`.
- [ ] توفير الأسرة وطلبات الأسرة والمرفقات والإشعارات والمحادثات والتقارير والتدقيق.
- [ ] تطبيق غلاف الاستجابة الموحد و`X-Request-Id`.

## قاعدة البيانات

- [ ] إضافة مولد `WASL-YYYY-NNNNNN`.
- [ ] إضافة جدول مصفوفة الانتقالات والتحقق من الدور والحالة.
- [ ] إضافة outbox للإشعارات وربطه بالانتقال داخل معاملة.
- [ ] تشديد قيود القرارات والحقول ومنع تعديل الإحالة المكتملة خارج الانتقال.
- [ ] سحب صلاحية `PUBLIC:EXECUTE` من دوال `SECURITY DEFINER`.
- [ ] إنشاء ترحيل بيانات legacy قابل لإعادة التشغيل مع تقرير فروقات.

## الجودة والنشر

- [ ] إضافة typecheck وbuild واختبارات unit/integration/security للعقود الجديدة.
- [ ] تحديث CI ليعمل على `main` ويختبر Backend v1 والترحيلات.
- [ ] تحديث Vercel أو خدمة Backend لتوجيه `/api/v1/*` إلى التطبيق الجديد.
- [ ] اختبار `/health`, `/health/deep`, وواجهات v1 على Production.
- [ ] عدم حذف legacy قبل اكتمال الترحيل والقبول.
