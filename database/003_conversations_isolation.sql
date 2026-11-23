-- 003_conversations_isolation.sql
-- وَصْل — تأمين app_state وتجهيز عزل المحادثات والمرفقات
--
-- هذه المسودة للقراءة والمراجعة فقط.
-- لا تنفّذها تلقائياً، ولا تنقل أو تحذف أي بيانات قديمة.
--
-- ملاحظات التصميم:
-- 1) app_state يبقى مصدر الحالة القديمة كما هو؛ لا توجد UPDATE/DELETE/INSERT عليه.
-- 2) بيانات DATA.chats وDATA.attachments داخل app_state لا تُرحّل تلقائياً.
-- 3) الجداول الجديدة مهيأة للاستخدام اللاحق عبر API خادمي يتحقق من العضوية.
-- 4) service_role هو مسار الخادم الحالي، ويتجاوز RLS بطبيعته؛ لا يُكشف للمتصفح.
-- 5) مسودة الترحيل لا تمنح الحساب الخامس أو أي حساب Auth غير موجود في
--    user_profiles صلاحية تشغيلية.

begin;

-- ---------------------------------------------------------------------------
-- A) تأمين public.app_state
-- ---------------------------------------------------------------------------

alter table public.app_state enable row level security;

-- لا وصول مباشر من العميل إلى الحالة الكاملة.
-- يقرأ ويكتب الخادم باستخدام service_role فقط بعد التحقق الخادمي من Auth.
revoke all privileges on table public.app_state from public, anon, authenticated;
revoke select, insert, update, delete, truncate, references, trigger
  on table public.app_state from public, anon, authenticated;

-- تأكيد عدم وجود صلاحية TRUNCATE مباشرة على أي من أدوار العميل.
revoke truncate on table public.app_state from public, anon, authenticated;

-- الصلاحيات المطلوبة للخادم فقط.
grant all privileges on table public.app_state to service_role;

-- لا تجعل دالة الحفظ قابلة للاستدعاء من العميل.
revoke all privileges on function public.save_app_state(integer, jsonb)
  from public, anon, authenticated;
revoke execute on function public.save_app_state(integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_app_state(integer, jsonb) to service_role;

-- الدالة التالية Trigger function وليست واجهة للعميل.
revoke all privileges on function public.touch_app_state()
  from public, anon, authenticated;

-- لا ننشئ أي policy على app_state عمداً:
-- مع RLS مفعّلاً وعدم وجود policy، يكون الوصول المباشر مرفوضاً،
-- بينما service_role يصل عبر مسار API الخادمي.

-- ---------------------------------------------------------------------------
-- C) جداول المحادثات الجديدة
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_type text not null default 'direct'
    check (conversation_type in ('direct', 'group')),
  title text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member'
    check (member_role in ('member', 'owner')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (length(body) <= 20000)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members(user_id, conversation_id);

create index if not exists conversation_messages_conversation_time_idx
  on public.conversation_messages(conversation_id, created_at, id);

create index if not exists conversations_updated_at_idx
  on public.conversations(updated_at desc);

-- ---------------------------------------------------------------------------
-- D) جدول بيانات المرفقات الجديدة
-- ---------------------------------------------------------------------------

create table if not exists public.conversation_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.conversation_messages(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  storage_bucket text not null default 'attachments',
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 15728640),
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create index if not exists conversation_attachments_conversation_idx
  on public.conversation_attachments(conversation_id, created_at desc);

create index if not exists conversation_attachments_message_idx
  on public.conversation_attachments(message_id);

-- ---------------------------------------------------------------------------
-- B) دالة مساعدة آمنة لفحص عضوية المحادثة
-- ---------------------------------------------------------------------------

create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = auth.uid()
  );
$$;

revoke all privileges on function public.is_conversation_member(uuid)
  from public, anon;
revoke execute on function public.is_conversation_member(uuid)
  from public, anon;
grant execute on function public.is_conversation_member(uuid)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- E) تفعيل RLS وسحب الصلاحيات الافتراضية
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_attachments enable row level security;

revoke all privileges on table public.conversations,
  public.conversation_members,
  public.conversation_messages,
  public.conversation_attachments
  from public, anon;

-- authenticated يحصل فقط على الصلاحيات التي تقيدها السياسات التالية.
grant select, insert, update, delete
  on table public.conversations,
              public.conversation_members,
              public.conversation_messages,
              public.conversation_attachments
  to authenticated;

grant all privileges on table public.conversations,
  public.conversation_members,
  public.conversation_messages,
  public.conversation_attachments
  to service_role;

-- ---------------------------------------------------------------------------
-- F) سياسات conversations
-- ---------------------------------------------------------------------------

create policy conversations_select_member
  on public.conversations
  for select to authenticated
  using (public.is_conversation_member(id));

create policy conversations_insert_creator
  on public.conversations
  for insert to authenticated
  with check (created_by = auth.uid());

create policy conversations_update_creator
  on public.conversations
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy conversations_delete_creator
  on public.conversations
  for delete to authenticated
  using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- G) سياسات أعضاء المحادثة
-- ---------------------------------------------------------------------------

create policy conversation_members_select_member
  on public.conversation_members
  for select to authenticated
  using (public.is_conversation_member(conversation_id));

-- لا يسمح بالانضمام الذاتي إلى محادثة عبر تخمين UUID.
-- الإضافة المباشرة محصورة بمنشئ المحادثة؛ ويستطيع API الخادمي استخدام service_role.
create policy conversation_members_insert_owner
  on public.conversation_members
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and c.created_by = auth.uid()
    )
  );

create policy conversation_members_update_owner
  on public.conversation_members
  for update to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and c.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and c.created_by = auth.uid()
    )
  );

create policy conversation_members_delete_owner
  on public.conversation_members
  for delete to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and c.created_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- H) سياسات الرسائل
-- ---------------------------------------------------------------------------

create policy conversation_messages_select_member
  on public.conversation_messages
  for select to authenticated
  using (public.is_conversation_member(conversation_id));

create policy conversation_messages_insert_member
  on public.conversation_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

create policy conversation_messages_update_sender
  on public.conversation_messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

create policy conversation_messages_delete_sender
  on public.conversation_messages
  for delete to authenticated
  using (sender_id = auth.uid());

-- ---------------------------------------------------------------------------
-- I) سياسات بيانات المرفقات
-- ---------------------------------------------------------------------------

create policy conversation_attachments_select_member
  on public.conversation_attachments
  for select to authenticated
  using (public.is_conversation_member(conversation_id));

create policy conversation_attachments_insert_member
  on public.conversation_attachments
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

create policy conversation_attachments_update_owner
  on public.conversation_attachments
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy conversation_attachments_delete_owner
  on public.conversation_attachments
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- J) سياسات Storage للمرفقات المرتبطة بالمحادثات
-- ---------------------------------------------------------------------------

-- لا نغيّر bucket أو الكائنات القديمة. هذه السياسات تخص أي كائن له سجل
-- جديد في conversation_attachments فقط. مسار API الخادمي يستخدم service_role.

create policy conversation_storage_select_member
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
      from public.conversation_attachments ca
      where ca.storage_bucket = storage.objects.bucket_id
        and ca.storage_path = storage.objects.name
        and public.is_conversation_member(ca.conversation_id)
    )
  );

create policy conversation_storage_insert_member
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1
      from public.conversation_attachments ca
      where ca.storage_bucket = storage.objects.bucket_id
        and ca.storage_path = storage.objects.name
        and ca.owner_id = auth.uid()
        and public.is_conversation_member(ca.conversation_id)
    )
  );

create policy conversation_storage_update_owner
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
      from public.conversation_attachments ca
      where ca.storage_bucket = storage.objects.bucket_id
        and ca.storage_path = storage.objects.name
        and ca.owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1
      from public.conversation_attachments ca
      where ca.storage_bucket = storage.objects.bucket_id
        and ca.storage_path = storage.objects.name
        and ca.owner_id = auth.uid()
        and public.is_conversation_member(ca.conversation_id)
    )
  );

create policy conversation_storage_delete_owner
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
      from public.conversation_attachments ca
      where ca.storage_bucket = storage.objects.bucket_id
        and ca.storage_path = storage.objects.name
        and ca.owner_id = auth.uid()
    )
  );

-- لا توجد أوامر حذف أو نقل أو تفريغ للبيانات القديمة في هذا الملف.
-- لا نغيّر صلاحيات أو سياسات قديمة بأسماء غير معروفة.

commit;

-- بعد المراجعة والتطبيق، يجب تحديث API لاحقاً ليكتب في الجداول الجديدة
-- ويتحقق من العضوية قبل القراءة/الرفع/التنزيل. هذا الملف وحده لا يرحّل
-- DATA.chats أو DATA.attachments ولا يغيّر سلوك التطبيق المنشور.