-- وَصْل: مصادقة الموظفين دون اشتراط بريد إلكتروني من الموظف.
-- يستخدم Supabase Auth بريداً تقنياً داخلياً غير ظاهر للمستخدم لأن Auth يحتاج معرّفاً بريدياً.

alter table public.user_profiles
  alter column email drop not null;

alter table public.user_profiles
  add column if not exists mobile text,
  add column if not exists must_change_password boolean not null default true,
  add column if not exists password_changed_at timestamptz;

create unique index if not exists user_profiles_mobile_unique_idx
  on public.user_profiles(mobile)
  where mobile is not null;

create index if not exists user_profiles_employee_active_idx
  on public.user_profiles(employee_number, active);

create table if not exists public.auth_requests (
  id uuid primary key default gen_random_uuid(),
  tracking_no text not null unique,
  employee_number text not null,
  full_name text not null,
  mobile text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  rejection_reason text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists auth_requests_employee_pending_idx
  on public.auth_requests(employee_number)
  where status = 'pending';
create index if not exists auth_requests_status_created_idx
  on public.auth_requests(status, created_at desc);

alter table public.auth_requests enable row level security;
revoke all on public.auth_requests from public, anon, authenticated;
grant all privileges on public.auth_requests to service_role;

create or replace function public.touch_auth_request()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_auth_requests_touch on public.auth_requests;
create trigger trg_auth_requests_touch
before update on public.auth_requests
for each row execute function public.touch_auth_request();

-- إزالة أي صلاحية تنفيذ عامة قديمة مع إبقاء الوصول الخادمي فقط.
revoke all on table public.user_profiles from public, anon, authenticated;
grant select on table public.user_profiles to authenticated;
