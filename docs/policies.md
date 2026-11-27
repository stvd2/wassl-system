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

-- <<< WASL-RLS-END