-- ============================================================================
-- وَصْل (Wassl) — مخطط قاعدة بيانات Supabase
-- ----------------------------------------------------------------------------
-- يعمل التطبيق بنموذج "حالة كاملة" (single source of truth) عبر جدول app_state.
-- الخادم (Node/Express) هو الوسيط الوحيد الذي يقرأ/يكتب هذا الجدول باستخدام
-- service_role key (يتجاوز RLS). لا يصل المتصفح إلى Supabase مباشرة أبداً.
-- ----------------------------------------------------------------------------
-- طريقة التطبيق: انسخ هذا الملف كاملاً والصقه في Supabase Dashboard →
-- SQL Editor → New query → Run.
-- ============================================================================

-- 1) جدول الحالة الكاملة للتطبيق
create table if not exists public.app_state (
  id         text primary key default 'main',
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists app_state_updated_at_idx
  on public.app_state (updated_at desc);

-- 2) أمان مستوى الصف (RLS)
-- نفعّل RLS ثم نحجب كل وصول مباشر عبر anon/authenticated، لأن الوصول يتم
-- حصرياً عبر service_role (يتجاوز RLS افتراضياً) من داخل الخادم.
alter table public.app_state enable row level security;

drop policy if exists "app_state_no_direct_access" on public.app_state;
create policy "app_state_no_direct_access"
  on public.app_state
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- 3) دالة لتحديث الطابع الزمني تلقائياً عند كل تعديل
create or replace function public.touch_app_state()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_app_state_touch on public.app_state;
create trigger trg_app_state_touch
  before update on public.app_state
  for each row execute function public.touch_app_state();

-- ============================================================================
-- ملاحظة تطويرية:
-- هذا هو المخطط التشغيلي الحالي (تخزين حالة التطبيق كاملة كـ JSON في صف واحد).
-- عند الحاجة لاحقاً لنموذج علائقي تفصيلي (جداول users / referrals / beds /
-- audit_logs / notifications / chats / shifts مع سياسات RLS لكل دور)، يمكن
-- تطويره هنا؛ يبقى الخادم هو النقطة الوحيدة لتحويل الحالة من/إلى الجداول.
-- ============================================================================
