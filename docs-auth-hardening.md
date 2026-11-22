# خطة تفعيل Supabase Auth في وُصل

هذه المرحلة تمهيدية ولا تفعّل التفويض على النسخة المنشورة. السبب أن الواجهة الحالية ما زالت تسجل الدخول محليًا من بيانات `app_state`، بينما حماية `/api/state` و`/api/attachment` قبل ربط الواجهة بجلسة Auth ستمنع المستخدمين الحاليين من العمل.

## التسلسل الإلزامي

1. فعّل Email/Password أو Phone/OTP في Supabase Auth، وحدد سياسة التحقق المناسبة. لا تنشئ مستخدمين إنتاجيين بكلمات المرور الافتراضية القديمة.
2. شغّل `database/001_supabase_auth_profiles.sql` في بيئة اختبار أولًا. أنشئ حساب Auth لكل مستخدم معتمد، ثم املأ `user_profiles.auth_user_id` وربط الرقم الوظيفي والدور والقسم والحالة.
3. اربط الواجهة بعميل Supabase Auth. يجب أن تستخدم الواجهة `signInWithPassword` أو تدفق OTP، وأن ترسل access token في ترويسة `Authorization: Bearer ...` لكل طلب API. لا تعتمد على `localStorage` لتحديد هوية أو دور.
4. حدّث `/api/state` و`/api/attachment` لاستخدام `requireUser(req)`، والتحقق من الدور في كل عملية. استخدم `auth.getUser(token)` على الخادم؛ لا تستخدم `getSession()` لاتخاذ قرار تفويض.
5. استبدل نموذج الحالة الكامل بواجهات عملية محددة أو تحقق خادمي من كل تغيير. لا يكفي قبول JSON كامل من العميل حتى مع وجود Auth.
6. اربط كل مرفق بسجل ومالك/صلاحية، امنع `upsert` على معرف موجود، وفّر تنزيلًا بعد التحقق فقط. حدّث MIME في Storage بعد اعتماد Excel/CSV واختبره في مشروع معزول.
7. بعد نجاح اختبارات التكامل، فعّل RLS والمنح المقيدة في الترحيل. لا تُشغّل ترحيل RLS على الإنتاج قبل وجود صفوف `user_profiles` وحسابات Auth واختبار rollback.

## فحوص القبول قبل التفعيل

- طلب API بلا token يعيد 401 ولا يقرأ `app_state` أو مرفقًا.
- token صحيح بلا `user_profiles` فعال يعيد 403.
- تغيير role في العميل لا يرفع الصلاحية.
- الطبيب لا يستطيع الطباعة أو قراءة مرفق لا يخص إحالة مصرحًا بها.
- المنسق يستطيع الوظائف المسموحة فقط، والمدير يستطيع الإدارة فقط بعد تحقق خادمي.
- انتهاء الجلسة أو تعطيل profile يوقف الطلبات اللاحقة.
- اختبارات RLS تثبت منع `anon` و`authenticated` من الكتابة المباشرة إلى `app_state`.

المراجع الرسمية: [Supabase SSR Auth](https://supabase.com/docs/guides/auth/server-side/creating-a-client)، [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)، [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
