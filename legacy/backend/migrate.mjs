// أداة ترحيل: إنشاء جدول app_state في Supabase (تشغيل لمرة واحدة)
// الاستخدام: DATABASE_URL="postgres://..." node migrate.mjs
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('خطأ: عرّف متغير البيئة DATABASE_URL.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const schema = `
create table if not exists public.app_state (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists app_state_updated_at_idx on public.app_state (updated_at desc);
grant all privileges on public.app_state to service_role;
create or replace function public.touch_app_state()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_app_state_touch on public.app_state;
create trigger trg_app_state_touch
  before update on public.app_state
  for each row execute function public.touch_app_state();
`;

try {
  await client.connect();
  await client.query(schema);
  const { rows } = await client.query(`select to_regclass('public.app_state') as t;`);
  console.log('OK — app_state table:', rows[0].t);
  await client.end();
} catch (e) {
  console.error('فشل الترحيل:', e.message);
  process.exit(1);
}
