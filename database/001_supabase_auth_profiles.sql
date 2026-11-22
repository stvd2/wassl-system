-- وَصْل: ترحيل تمهيدي للمصادقة الخادمية.
-- لا تُشغّل هذا الملف على الإنتاج قبل إنشاء مستخدمي Supabase Auth وربطهم
-- ومراجعة اختبارات التكامل. لا يغيّر app_state تلقائيًا.

create table if not exists public.user_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  employee_number text not null unique,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('admin','coordinator','doctor','beds')),
  department text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_role_active_idx
  on public.user_profiles(role, active);

-- اربط البريد في هذا الجدول ببريد auth.users عند إنشاء الحساب؛ لا تُضع
-- كلمات المرور هنا ولا تُنسخ إلى app_state.

alter table public.user_profiles enable row level security;
revoke all on table public.user_profiles from public, anon, authenticated;
grant select on table public.user_profiles to authenticated;

-- لا يسمح للمستخدم بقراءة إلا ملفه. التحقق الخادمي يستخدم service_role
-- بعد getUser() ويطبق الدور من هذا الجدول، وليس من بيانات العميل.
drop policy if exists user_profiles_self_select on public.user_profiles;
create policy user_profiles_self_select
  on public.user_profiles for select to authenticated
  using ((select auth.uid()) = auth_user_id);

-- الحالة الكاملة والمرفقات لا تُعرَض مباشرة عبر Data API. تبقى خلف API
-- خادمي يتحقق من Auth، مع إبقاء service_role للوصول الداخلي فقط.
alter table public.app_state enable row level security;
revoke all on table public.app_state from public, anon, authenticated;
grant all privileges on table public.app_state to service_role;

-- الدالة القديمة لا يجب أن تكون قابلة للاستدعاء العام. سيستدعيها API
-- الخادمي فقط بعد التحقق من Auth والدور.
revoke execute on function public.save_app_state(integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_app_state(integer, jsonb) to service_role;

-- لا تمنح Storage للعميل مباشرة في نموذج الحالة القديم.
-- طبّق هذا بعد تدقيق سياسات Storage الموجودة في المشروع:
-- revoke all on storage.objects from anon, authenticated;

create or replace function public.touch_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_touch on public.user_profiles;
create trigger trg_user_profiles_touch
before update on public.user_profiles
for each row execute function public.touch_user_profile();
