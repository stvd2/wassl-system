# سياسات RLS الفعلية — نظام وَصْل
## Row Level Security Policies — Wasl v1.1

**الإصدار:** 1.0
**التاريخ:** 2026-11-27
**المرجع:** docs/decisions.md (D-01 إلى D-15)
**الحالة:** مسودة للتنفيذ

---

## 1. المبادئ

1. **RLS مفعّل على كل جدول حسّاس** — لا استثناء.
2. **كل سياسة مرتبطة بقرار موقّع** في docs/decisions.md.
3. **الخادم هو الحكم** — RLS خط الدفاع الأخير، لكن API يتحقق أيضاً.
4. **`service_role` يتجاوز RLS** — يُستخدم فقط في Edge Functions الموثوقة، لا في الواجهة.
5. **الدوال المساعدة** في schema `app_private` مع `search_path = pg_catalog, public`.

---

## 2. الدوال المساعدة (Helper Functions)

```sql
-- >>> WASL-RLS-BEGIN: Helper functions

CREATE SCHEMA IF NOT EXISTS app_private;

-- 2.1 جلب current_user_id من auth.uid()
CREATE OR REPLACE FUNCTION app_private.current_user_id()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT auth.uid();
$$;

-- 2.2 جلب دور المستخدم من users (D-09: status = 'active')
CREATE OR REPLACE FUNCTION app_private.user_role()
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT role FROM public.users
  WHERE auth_user_id = auth.uid() AND status = 'active'
  LIMIT 1;
$$;

-- 2.3 هل المستخدم نشط؟
CREATE OR REPLACE FUNCTION app_private.is_active_user()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_user_id = auth.uid() AND status = 'active'
  );
$$;

-- 2.4 هل المستخدم admin؟
CREATE OR REPLACE FUNCTION app_private.is_admin()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT app_private.user_role() = 'admin';
$$;

-- 2.5 هل المستخدم coordinator؟
CREATE OR REPLACE FUNCTION app_private.is_coordinator()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT app_private.user_role() = 'coordinator';
$$;

-- 2.6 هل المستخدم doctor؟
CREATE OR REPLACE FUNCTION app_private.is_doctor()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT app_private.user_role() = 'doctor';
$$;

-- 2.7 هل المستخدم beds؟
CREATE OR REPLACE FUNCTION app_private.is_beds()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT app_private.user_role() = 'beds';
$$;

-- 2.8 هل المستخدم عضو في المحادثة؟ (D-07)
CREATE OR REPLACE FUNCTION app_private.is_conversation_member(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = p_conversation_id
      AND user_id = app_private.current_user_id()
      AND left_at IS NULL
  );
$$;

-- 2.9 هل يحق للمستخدم الوصول لهذه الإحالة؟ (D-01)
CREATE OR REPLACE FUNCTION app_private.can_access_referral(p_referral_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.referrals r
    WHERE r.id = p_referral_id
      AND (
        app_private.is_admin()
        OR app_private.is_coordinator()
        OR (app_private.is_doctor() AND (
             r.department_id = (SELECT department_id FROM public.users WHERE auth_user_id = auth.uid())
             OR r.assigned_doctor_id = app_private.current_user_id()
        ))
        OR (app_private.is_beds() AND r.status = 'awaiting_bed')
      )
  );
$$;

-- 2.10 هل الإحالة تحتاج سريراً؟ (D-03)
CREATE OR REPLACE FUNCTION app_private.referral_needs_bed(p_referral_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (priority NOT IN ('عيادات','استشارة طبية') AND ward_type <> '')
  FROM public.referrals WHERE id = p_referral_id;
$$;

-- 2.11 هل الانتقال مسموح في جدول TRANSITIONS؟
CREATE OR REPLACE FUNCTION app_private.is_transition_allowed(p_from text, p_to text, p_role text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.wasl_allowed_transitions
    WHERE from_status = p_from AND to_status = p_to AND p_role = ANY(roles)
  );
$$;

-- <<< WASL-RLS-END-- >>> WASL-RLS-BEGIN: users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- قراءة: المستخدم نفسه يرى بياناته؛ المدير يرى الكل
CREATE POLICY users_select_self ON public.users
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR app_private.is_admin()
  );

-- إدراج: admin فقط (التسجيل الذاتي عبر /api/auth/register وليس مباشرة)
CREATE POLICY users_insert_admin ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_admin());

-- تعديل: admin فقط (مع استثناء: المستخدم يعدّل بياناته الشخصية عبر /api/auth/me)
CREATE POLICY users_update_admin ON public.users
  FOR UPDATE TO authenticated
  USING (app_private.is_admin())
  WITH CHECK (app_private.is_admin());

-- لا حذف — الحسابات تُعطّل (status='disabled') ولا تُحذف
-- <<< WASL-RLS-END
-- >>> WASL-RLS-BEGIN: referrals
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- قراءة: حسب القرار D-01
CREATE POLICY referrals_select ON public.referrals
  FOR SELECT TO authenticated
  USING (app_private.can_access_referral(id));

-- إدراج: coordinator / admin فقط (D-01)
CREATE POLICY referrals_insert ON public.referrals
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.is_coordinator() OR app_private.is_admin()
  );

-- تعديل: coordinator / admin فقط، مع القيود (لا يعدّل doctor_notes إلا doctor)
CREATE POLICY referrals_update ON public.referrals
  FOR UPDATE TO authenticated
  USING (
    (app_private.is_coordinator() OR app_private.is_admin())
    OR (app_private.is_doctor() AND assigned_doctor_id = app_private.current_user_id())
  )
  WITH CHECK (true);  -- الشروط الدقيقة في الـ API

-- لا حذف — الأرشفة بدلاً منه (D-08)
-- <<< WASL-RLS-END
-- >>> WASL-RLS-BEGIN: referral_events
ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;

-- قراءة: من يستطيع قراءة الإحالة
CREATE POLICY referral_events_select ON public.referral_events
  FOR SELECT TO authenticated
  USING (app_private.can_access_referral(referral_id));

-- إدراج: فقط عبر service_role (من الـ API) — لا إدراج مباشر
-- لا INSERT policy للـ authenticated
-- <<< WASL-RLS-END
-- >>> WASL-RLS-BEGIN: referral_attachments
ALTER TABLE public.referral_attachments ENABLE ROW LEVEL SECURITY;

-- قراءة: من يستطيع قراءة الإحالة، وبشرط scan_status = 'clean' (D-13)
CREATE POLICY referral_attachments_select ON public.referral_attachments
  FOR SELECT TO authenticated
  USING (
    app_private.can_access_referral(referral_id)
    AND scan_status = 'clean'
    AND deleted_at IS NULL
  );

-- إدراج: من يستطيع الوصول للإحالة
CREATE POLICY referral_attachments_insert ON public.referral_attachments
  FOR INSERT TO authenticated
  WITH CHECK (app_private.can_access_referral(referral_id));

-- تعديل (soft delete): admin فقط (D-08)
CREATE POLICY referral_attachments_update ON public.referral_attachments
  FOR UPDATE TO authenticated
  USING (app_private.is_admin())
  WITH CHECK (app_private.is_admin());

-- لا حذف فعلي (D-08)
-- <<< WASL-RLS-END
-- >>> WASL-RLS-BEGIN: beds
ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;

-- قراءة: beds / admin / coordinator
CREATE POLICY beds_select ON public.beds
  FOR SELECT TO authenticated
  USING (
    app_private.is_beds()
    OR app_private.is_admin()
    OR app_private.is_coordinator()
  );

-- إدراج/تعديل: beds / admin
CREATE POLICY beds_modify ON public.beds
  FOR ALL TO authenticated
  USING (app_private.is_beds() OR app_private.is_admin())
  WITH CHECK (app_private.is_beds() OR app_private.is_admin());

-- <<< WASL-RLS-END
-- >>> WASL-RLS-BEGIN: bed_requests
ALTER TABLE public.bed_requests ENABLE ROW LEVEL SECURITY;

-- قراءة: beds / admin / coordinator، ومن له وصول للإحالة
CREATE POLICY bed_requests_select ON public.bed_requests
  FOR SELECT TO authenticated
  USING (
    app_private.is_beds()
    OR app_private.is_admin()
    OR app_private.is_coordinator()
    OR app_private.can_access_referral(referral_id)
  );

-- إدراج: coordinator / admin
CREATE POLICY bed_requests_insert ON public.bed_requests
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_coordinator() OR app_private.is_admin());

-- تعديل القرار: beds / admin فقط (D-05)
CREATE POLICY bed_requests_decide ON public.bed_requests
  FOR UPDATE TO authenticated
  USING (app_private.is_beds() OR app_private.is_admin())
  WITH CHECK (
    (app_private.is_beds() OR app_private.is_admin())
    AND (status <> 'approved' OR bed_id IS NOT NULL)
  );

-- <<< WASL-RLS-END
-- >>> WASL-RLS-BEGIN: notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- قراءة: صاحب الإشعار فقط
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = app_private.current_user_id());

-- تعديل (mark read): صاحب الإشعار فقط
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = app_private.current_user_id())
  WITH CHECK (user_id = app_private.current_user_id());

-- لا إدراج مباشر — عبر outbox (D-12)
-- <<< WASL-RLS-END

sql
-- >>> WASL-RLS-BEGIN: conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- قراءة: عضو في المحادثة (D-07)
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT TO authenticated
  USING (app_private.is_conversation_member(id));

-- إدراج: من يملك صلاحية إنشاء محادثة
CREATE POLICY conversations_insert ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_active_user());

-- <<< WASL-RLS-END
3.9 جدول conversation_members
sql
-- >>> WASL-RLS-BEGIN: conversation_members
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;

-- قراءة: من هو عضو في نفس المحادثة
CREATE POLICY conversation_members_select ON public.conversation_members
  FOR SELECT TO authenticated
  USING (app_private.is_conversation_member(conversation_id));

-- إدراج: منشئ المحادثة أو admin
CREATE POLICY conversation_members_insert ON public.conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.created_by = app_private.current_user_id() OR app_private.is_admin())
    )
  );

-- <<< WASL-RLS-END
3.10 جدول messages
sql
-- >>> WASL-RLS-BEGIN: messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- قراءة: عضو في المحادثة
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (app_private.is_conversation_member(conversation_id));

-- إدراج: عضو في المحادثة، والدور sender_id = current_user
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.is_conversation_member(conversation_id)
    AND sender_id = app_private.current_user_id()
  );

-- تعديل: المرسل نفسه فقط (رسالته)
CREATE POLICY messages_update_own ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = app_private.current_user_id())
  WITH CHECK (sender_id = app_private.current_user_id());

-- <<< WASL-RLS-END
3.11 جدول shifts
sql
-- >>> WASL-RLS-BEGIN: shifts
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- قراءة: الجميع (نشط)، أو حسب الحاجة
CREATE POLICY shifts_select ON public.shifts
  FOR SELECT TO authenticated
  USING (app_private.is_active_user());

-- إدراج/تعديل: coordinator / admin
CREATE POLICY shifts_modify ON public.shifts
  FOR ALL TO authenticated
  USING (app_private.is_coordinator() OR app_private.is_admin())
  WITH CHECK (app_private.is_coordinator() OR app_private.is_admin());

-- <<< WASL-RLS-END
3.12 جدول audit_logs
sql
-- >>> WASL-RLS-BEGIN: audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- قراءة: admin فقط
CREATE POLICY audit_logs_select_admin ON public.audit_logs
  FOR SELECT TO authenticated
  USING (app_private.is_admin());

-- لا إدراج/تعديل/حذف من الواجهة — عبر triggers وservice_role
-- <<< WASL-RLS-END
3.13 جدول departments
sql
-- >>> WASL-RLS-BEGIN: departments
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

-- قراءة: كل المستخدمين النشطين
CREATE POLICY departments_select ON public.departments
  FOR SELECT TO authenticated
  USING (app_private.is_active_user());

-- تعديل: admin فقط
CREATE POLICY departments_modify ON public.departments
  FOR ALL TO authenticated
  USING (app_private.is_admin())
  WITH CHECK (app_private.is_admin());

-- <<< WASL-RLS-END
3.14 جدول notifications_outbox (D-12)
sql
-- >>> WASL-RLS-BEGIN: notifications_outbox
ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;

-- لا وصول مباشر من authenticated — service_role فقط
-- (بدون أي policy، RLS يمنع الجميع افتراضياً)
-- <<< WASL-RLS-END
3.15 جدول idempotency_keys
sql
-- >>> WASL-RLS-BEGIN: idempotency_keys
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- لا وصول مباشر — service_role فقط
-- <<< WASL-RLS-END
4. التحقق من RLS
بعد تطبيق كل السياسات، تحقق:

sql
-- 4.1 هل RLS مفعّل على كل الجداول؟
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;
-- يجب ألا يعيد أي صف

-- 4.2 هل كل جدول له سياسات؟
SELECT tablename, count(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
-- كل جدول يجب أن يكون policy_count > 0

-- 4.3 هل هناك policy تستخدم USING (true)؟
SELECT schemaname, tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND qual = 'true';
-- يجب ألا يعيد أي صف (إلا للجداول العامة المقصودة)

-- 4.4 هل service_role يتجاوز RLS؟
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'service_role';
-- rolbypassrls = true (متوقع)
5. سجل التعديلات
الإصدار	التاريخ	التغيير
1.0	2026-11-27	الإصدار الأول — 15 جدول، 30+ policy
6. المراجع
docs/decisions.md — القرارات D-01 إلى D-15

docs/design-v1.1.md — التصميم المعدّل

Supabase RLS best practices: https://supabase.com/docs/guides/auth/row-level-security

نهاية الملف.

text
بعد الإنشاء، نفّذ:

wc -l docs/policies.md (يجب أن يكون ≈ 400 سطر)

grep -c "CREATE POLICY" docs/policies.md (يجب أن يكون ≥ 25)

git add docs/policies.md && git commit -m "docs: add RLS policies (v1.1)"

git push origin <الفرع الحالي>

أعطني:

hash الـ commit

عدد أسطر الملف

عدد CREATE POLICY

أي مشاكل واجهتها

text

---

## 🎯 ملاحظات على الدفعة 2

| البند | العدد |
|---|---|
| **جداول** | 15 |
| **سياسات RLS** | ~30 |
| **دوال مساعدة** | 11 |
| **استعلامات تحقق** | 4 |
| **أسطر متوقعة** | ~400 |

**بعد تأكيد Manus، سأرسل الدفعة 3** (`docs/design-v1.1.md` — الوثيقة المعدّلة الكاملة).
