-- ============================================================================
-- وَصْل (Wassl) — مخطط قاعدة بيانات Supabase (النسخة العاملة)
-- ----------------------------------------------------------------------------
-- يعمل التطبيق بنموذج "حالة كاملة" (single source of truth) عبر جدول app_state.
-- الخادم (Node/Express) هو الوسيط الوحيد الذي يقرأ/يكتب الجدول باستخدام
-- المفتاح السري (service_role). لا يصل المتصفح إلى Supabase مباشرة أبداً،
-- لذلك لا نفعّل RLS هنا (تفعيله كان يحجب المفتاح السري نفسه في البنية الحالية).
-- ----------------------------------------------------------------------------
-- طريقة التطبيق: الصق الملف كاملاً في Supabase → SQL Editor → Run.
-- ============================================================================

create table if not exists public.app_state (
  id         text primary key default 'main',
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists app_state_updated_at_idx
  on public.app_state (updated_at desc);

-- منح الصلاحيات للمفتاح السري (service_role) الذي يستخدمه الخادم
grant all privileges on public.app_state to service_role;

-- دالة لتحديث الطابع الزمني تلقائياً عند كل تعديل
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
