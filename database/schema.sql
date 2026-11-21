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

-- حفظ مشروط بالإصدار لمنع جهاز من الكتابة فوق تعديل جهاز آخر
create or replace function public.save_app_state(expected_revision integer, next_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_data jsonb;
  current_revision integer;
  saved_data jsonb;
begin
  select data into current_data
  from public.app_state
  where id = 'main'
  for update;

  if current_data is null then current_data := '{}'::jsonb; end if;
  current_revision := coalesce(nullif(current_data #>> '{meta,sync_revision}', '')::integer, 0);

  if current_revision <> coalesce(expected_revision, 0) then
    return jsonb_build_object('ok', false, 'conflict', true, 'current', current_data, 'current_revision', current_revision);
  end if;

  saved_data := jsonb_set(coalesce(next_data, '{}'::jsonb), '{meta,sync_revision}', to_jsonb(current_revision + 1), true);
  insert into public.app_state (id, data) values ('main', saved_data)
  on conflict (id) do update set data = excluded.data, updated_at = now();

  return jsonb_build_object('ok', true, 'conflict', false, 'data', saved_data, 'revision', current_revision + 1);
end;
$$;

grant execute on function public.save_app_state(integer, jsonb) to service_role;
