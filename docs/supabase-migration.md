# خطة الترحيل إلى Supabase والـ REST v1
## Supabase Migration Plan — Wasl v1.1

**الإصدار:** 1.0
**التاريخ:** 2026-11-27
**المرجع:** docs/design-v1.1.md + docs/policies.md + docs/decisions.md
**الحالة:** خطة تنفيذ (تحتاج اختباراً على بيئة staging قبل الإنتاج)

---

## 1. الوضع الحالي (v1.0)

### 1.1 البنية الحالية
┌─────────────────────────────────────────────┐
│ public/index.html (واجهة واحدة) │
│ - reads localStorage (wasl_v6) │
│ - reads/writes /api/state (GET/POST) │
│ - BroadcastChannel للـ sync بين التبويبات │
└─────────────────────────────────────────────┘
│ HTTPS
▼
┌─────────────────────────────────────────────┐
│ /api/state (Vercel Function) │
│ - GET: يقرأ app_state.main (JSONB كامل) │
│ - POST: يكتب app_state.main (JSONB كامل) │
│ - conflict resolution: sync_revision │
└─────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────┐
│ Supabase PostgreSQL │
│ - app_state.main (JSONB: كل البيانات) │
│ - referrals, users, audit, ... (مضمّنة) │
└─────────────────────────────────────────────┘

text

### 1.2 المشاكل

| # | المشكلة | الأثر |
|---|---|---|
| 1 | كل البيانات في `app_state.main` (JSONB واحد) | لا يمكن الاستعلام أو الفلترة على مستوى SQL |
| 2 | لا RLS — الوصول عبر `service_role` فقط | أي ثغرة في `/api/state` = وصول كامل |
| 3 | `localStorage` مصدر بيانات أساسي | تعارض بين الأجهزة، لا مزامنة حقيقية |
| 4 | `BroadcastChannel` للتزامن | يعمل فقط في نفس المتصفح |
| 5 | لا optimistic locking حقيقي | تعديل متزامن = فقدان بيانات |
| 6 | لا audit logs موحدة | صعوبة تتبع من فعل ماذا |
| 7 | المرفقات داخل JSONB | حجم JSONB يكبر بسرعة، لا Storage |

---

## 2. الوضع المستهدف (v1.1)

### 2.1 البنية المستهدفة
┌─────────────────────────────────────────────┐
│ public/index.html (أو v1 SPA لاحقاً) │
│ - لا localStorage للبيانات التشغيلية │
│ - fetch('/api/v1/...') + Bearer Token │
│ - Supabase Realtime للإشعارات │
└─────────────────────────────────────────────┘
│ HTTPS
▼
┌─────────────────────────────────────────────┐
│ /api/v1/* (REST) │
│ - Express / Vercel Functions │
│ - JWT verification (Supabase Auth) │
│ - التحقق من RLS عبر service_role │
│ - optimistic locking (version) │
└─────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────┐
│ Supabase PostgreSQL (علائقي) │
│ - users, referrals, referral_events, ... │
│ - RLS مفعّل (docs/policies.md) │
│ - Triggers للـ version, audit, outbox │
└─────────────────────────────────────────────┘
│
├──► Supabase Storage (المرفقات)
├──► Supabase Realtime (الإشعارات)
└──► Supabase Edge Functions (فحص المرفقات)

text

### 2.2 المبادئ

1. **PostgreSQL هو المصدر الوحيد للحقيقة** — لا localStorage، لا JSONB عملاق.
2. **كل جدول له RLS** — الواجهة تصل عبر `authenticated`، ليس `service_role`.
3. **الـ API يتحقق من الصلاحيات مرتين:** JWT + RLS.
4. **Realtime عبر Supabase** — ليس BroadcastChannel.
5. **المرفقات في Storage** — ليس في JSONB.
6. **Idempotency-Key** على كل POST حساس.
7. **If-Match (version)** على كل PATCH.

---

## 3. استراتيجية الترحيل — 4 مراحل

### المرحلة 1 — Shadow Read (أسبوعان)

**الهدف:** بناء REST v1 بالتوازي مع `/api/state`، دون كسر الإنتاج.

**ما يحدث:**
- `public/index.html` يظل يقرأ من `/api/state` (لا تغيير).
- نبني `/api/v1/*` على فرع منفصل (`feat/rest-v1`).
- نكتب **Adapter Layer** يحوّل بين `app_state.main` (JSONB) والجداول العلائقية.
- Migration ينشئ الجداول الجديدة + يملؤها من `app_state.main` (data backfill).
- نكتب اختبارات API شاملة.

**المخارج:**
- `/api/v1/*` يعمل على staging.
- الجداول الجديدة مملوءة ومتزامنة مع `app_state.main`.
- اختبارات API ناجحة (100%).

**Rollback:** لا شيء — الإنتاج لم يتغير.

---

### المرحلة 2 — Dual Write (أسبوعان)

**الهدف:** الكتابة في الاثنين (`app_state.main` + الجداول الجديدة) لضمان التوافق.

**ما يحدث:**
- `/api/state` POST يكتب في `app_state.main` **و** الجداول الجديدة (عبر trigger أو application code).
- نضيف **Feature Flag:** `WASL_USE_REST_V1=false` (افتراضياً).
- عند `true`، `public/index.html` يستخدم `/api/v1/*` بدلاً من `/api/state`.
- نختبر على staging مع Flag=true.
- ثم نفعّلها على 5% من المستخدمين (canary).

**المخارج:**
- Dual write يعمل بدون فقدان بيانات.
- Flag=true يعمل على staging.
- Canary 5% ناجح لمدة أسبوع.

**Rollback:** إيقاف Flag → العودة لـ `/api/state`.

---

### المرحلة 3 — Cutover (أسبوع)

**الهدف:** نقل 100% من المستخدمين إلى REST v1.

**ما يحدث:**
- رفع canary إلى 25% → 50% → 100% (كل 48 ساعة).
- مراقبة الأخطاء (Sentry، logs).
- عند 100% لمدة أسبوع بدون أخطاء:
  - إيقاف Dual Write → الكتابة في الجداول فقط.
  - `/api/state` يبقى للقراءة فقط (read-only) لمدة شهر.
  - الواجهة تعتمد `/api/v1/*` حصراً.

**المخارج:**
- 100% من المستخدمين على REST v1.
- `/api/state` read-only.
- لا أخطاء في Sentry.

**Rollback:** إعادة Flag إلى false (خلال أول 24 ساعة).

---

### المرحلة 4 — Cleanup (شهر)

**الهدف:** إزالة الكود القديم.

**ما يحدث:**
- حذف `/api/state` (بعد التأكد من عدم استخدامه).
- حذف `app_state` table.
- حذف `BroadcastChannel` من `public/index.html`.
- حذف `localStorage` keys المتعلقة بالبيانات.
- توثيق ما تم.
- إصدار v2.0.

**Rollback:** استعادة `app_state` من backup (إن لزم).

---

## 4. Adapter Layer

### 4.1 الغرض

جسر بين `app_state.main` (JSONB) والجداول العلائقية أثناء المراحل 1-2.

### 4.2 الكود

```javascript
// backend/src/adapters/state-to-relational.js

/**
 * يحوّل app_state.main إلى صفوف في الجداول العلائقية.
 * يُستخدم في المرحلة 1 (data backfill) والمرحلة 2 (dual write).
 */
async function stateToRelational(state, supabase) {
  const { users, referrals, beds, outgoing_referrals, audit, notifications, chats, shifts } = state;

  // 1. users
  for (const u of users || []) {
    await supabase.from('users').upsert({
      id: u.id,
      username: u.username,
      employee_no: u.employee_no || null,
      full_name: u.full_name,
      mobile: u.mobile || null,
      email: u.email || null,
      role: u.role,
      status: mapUserStatus(u),
      department_id: await resolveDepartmentId(u.department, supabase),
      auth_user_id: u.auth_user_id || null,
      created_at: u.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
  }

  // 2. referrals
  for (const r of referrals || []) {
    const { error } = await supabase.from('referrals').upsert({
      id: r.id,
      ref_no: r.ref_no || `MIGRATED-${r.id}`,
      patient_name: r.patient_name,
      patient_identifier: r.patient_identifier || null,
      priority: r.priority,
      admission_type: r.admission_type || null,
      department_id: await resolveDepartmentId(r.target_specialty, supabase),
      status: r.status,
      created_by: r.created_by,
      assigned_doctor_id: r.assigned_doctor_id || null,
      clinical_summary: r.clinical_summary || null,
      diagnosis: r.diagnosis || null,
      notes: r.notes || null,
      needed_info: r.needed_info || null,
      supplement_notes: r.supplement_notes || null,
      doctor_decision: r.doctor_decision || null,
      doctor_notes: r.doctor_notes || null,
      version: 1,
      created_at: r.created_at,
      updated_at: r.updated_at || r.created_at,
      completed_at: r.completed_at || null
    }, { onConflict: 'id' });
    if (error) throw new Error(`referrals upsert ${r.id}: ${error.message}`);
  }

  // 3. referral_events (من r.timeline)
  for (const r of referrals || []) {
    for (const ev of r.timeline || []) {
      await supabase.from('referral_events').upsert({
        id: ev.id || `EV_${r.id}_${ev.ts}`,
        referral_id: r.id,
        actor_id: ev.user_id || null,
        from_status: ev.from || null,
        to_status: ev.to || null,
        action: ev.action || 'unknown',
        notes: ev.details?.notes || null,
        details: ev.details || {},
        created_at: ev.ts
      }, { onConflict: 'id' });
    }
  }

  // 4. beds
  for (const b of beds || []) {
    await supabase.from('beds').upsert({
      id: b.id,
      number: b.number,
      type: b.type || null,
      ward: b.ward || null,
      status: b.available === true ? 'available' : 'occupied',
      created_at: b.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
  }

  // 5. conversations + members + messages
  for (const c of chats || []) {
    await supabase.from('conversations').upsert({
      id: c.id,
      referral_id: c.referral_id || null,
      type: c.type === 'group' ? 'group' : 'direct',
      created_by: c.created_by || c.members?.[0] || null,
      created_at: c.created_at || new Date().toISOString()
    }, { onConflict: 'id' });
    for (const m of c.members || []) {
      await supabase.from('conversation_members').upsert({
        id: `CM_${c.id}_${m}`,
        conversation_id: c.id,
        user_id: m,
        joined_at: c.created_at || new Date().toISOString(),
        left_at: null
      }, { onConflict: 'conversation_id,user_id' });
    }
    for (const msg of c.messages || []) {
      await supabase.from('messages').upsert({
        id: msg.id,
        conversation_id: c.id,
        sender_id: msg.sender_id,
        body: msg.text || msg.body,
        created_at: msg.ts
      }, { onConflict: 'id' });
    }
  }

  // 6. shifts
  for (const s of shifts || []) {
    await supabase.from('shifts').upsert({
      id: s.id,
      user_id: s.user_id,
      role: s.role,
      shift_date: s.date,
      shift_type: s.shift
    }, { onConflict: 'id' });
  }

  // 7. notifications (من notifications_outbox)
  for (const n of notifications || []) {
    await supabase.from('notifications_outbox').insert({
      id: n.id,
      user_id: n.user_id || null,
      type: n.type || 'legacy',
      payload: {
        role: n.role,
        referral_id: n.referral_id,
        message: n.message,
        from_user: n.from_user
      },
      status: 'pending',
      attempts: 0,
      created_at: n.ts
    });
  }

  // 8. audit
  for (const a of audit || []) {
    await supabase.from('audit_logs').insert({
      id: a.id,
      actor_id: null,
      action: a.action,
      entity_type: a.entity_type,
      entity_id: a.entity_id,
      details: { legacy_hash: a.hash, legacy_user: a.user, legacy_role: a.role, notes: a.details },
      created_at: a.ts
    });
  }
}

function mapUserStatus(u) {
  if (u.active === true) return 'active';
  if (u.rejected === true) return 'rejected';
  if (u.pending_approval === true) return 'pending';
  return 'disabled';
}

async function resolveDepartmentId(name, supabase) {
  if (!name) return null;
  const { data } = await supabase.from('departments').select('id').eq('name', name).maybeSingle();
  if (data) return data.id;
  const { data: inserted } = await supabase.from('departments').insert({ name }).select('id').single();
  return inserted?.id || null;
}

module.exports = { stateToRelational };
4.3 الاستخدام
javascript
// في /api/state POST (المرحلة 2 - Dual Write):
const state = req.body;
// 1. الكتابة في app_state.main (السلوك الحالي)
await supabase.from('app_state').upsert({ id: 'main', data: state });
// 2. الكتابة في الجداول العلائقية (جديد)
if (process.env.WASL_DUAL_WRITE === 'true') {
  await stateToRelational(state, supabase);
}
5. Realtime Migration
5.1 من BroadcastChannel إلى Supabase Realtime
الوضع الحالي:

javascript
const SYNC_CHANNEL = new BroadcastChannel('wasl_sync_channel');
SYNC_CHANNEL.onmessage = event => { /* ... */ };
الهدف:

javascript
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
sb.channel('referrals-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'referrals' }, payload => {
    // إعادة تحميل الإحالة المتأثرة فقط
  })
  .subscribe();
5.2 اشتراكات مطلوبة
الجدول	الحدث	المستخدم
referrals	INSERT/UPDATE	حسب RLS
referral_events	INSERT	حسب RLS
notifications	INSERT	user_id = auth.uid()
messages	INSERT	عضو المحادثة
5.3 الأمان
RLS يحدد من يرى ماذا — Supabase Realtime يحترم RLS تلقائياً.

لا تستخدم service_role في الواجهة — استخدم anon_key فقط.

JWT يجب أن يحتوي role claim — authenticated للمستخدمين النشطين.

6. Storage Migration
6.1 المرفقات الحالية
مخزنة في app_state.attachments (Base64 أو URLs).

حجم app_state يكبر بسرعة (كل مرفق 1-4 MB).

6.2 الهدف
Bucket: attachments (private)

Path: referrals/{referral_id}/{attachment_id}

RLS على Storage: storage.objects policies

Signed URLs: صلاحية 5 دقائق للتنزيل

6.3 Migration Script
sql
-- >>> WASL-MIGRATION-BEGIN: storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('attachments', 'attachments', false, 15728640, ARRAY[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv'
])
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
CREATE POLICY attachments_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = 'referrals'
    AND app_private.can_access_referral((storage.foldername(name))[2]::uuid)
  );

CREATE POLICY attachments_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = 'referrals'
    AND app_private.can_access_referral((storage.foldername(name))[2]::uuid)
  );
-- <<< WASL-MIGRATION-END
6.4 نقل المرفقات الموجودة
javascript
// سكربت لمرة واحدة
async function migrateAttachments(state, supabase) {
  for (const [id, att] of Object.entries(state.attachments || {})) {
    const blob = Buffer.from(att.base64, 'base64');
    const path = `referrals/${att.referral_id}/${id}`;
    await supabase.storage.from('attachments').upload(path, blob, {
      contentType: att.mime_type,
      upsert: true
    });
    await supabase.from('referral_attachments').insert({
      id,
      referral_id: att.referral_id,
      uploaded_by: att.uploaded_by,
      storage_path: path,
      file_name: att.name,
      mime_type: att.mime_type,
      file_size: blob.length,
      scan_status: 'pending',
      created_at: att.ts
    });
  }
}
7. المخاطر و Rollback
7.1 جدول المخاطر
المخاطرة	الاحتمال	الأثر	التخفيف
فقدان بيانات أثناء Dual Write	متوسط	عالٍ	اختبار على staging + backup قبل كل مرحلة
تعارض RLS مع الواجهة	عالٍ	متوسط	اختبار كل دور + Feature Flag
بطء Realtime	منخفض	متوسط	fallback إلى polling
رفع مرفقات كبيرة	متوسط	منخفض	15 MB limit + progress bar
تعارض expected_version	متوسط	منخفض	409 + UI يطلب إعادة التحميل
فشل فحص المرفقات	منخفض	متوسط	scan_status='pending' لا يحجب الرفع، يحجب التنزيل فقط
7.2 Rollback Plan
المرحلة	Rollback	الوقت
1 (Shadow Read)	لا شيء — الإنتاج لم يتغير	0
2 (Dual Write)	WASL_DUAL_WRITE=false + WASL_USE_REST_V1=false	< 5 دقائق
3 (Cutover 5-100%)	WASL_USE_REST_V1=false + مراقبة	< 5 دقائق
3 (Cutover 100%)	استعادة app_state.main من backup + WASL_USE_REST_V1=false	< 30 دقيقة
4 (Cleanup)	استعادة app_state من backup	< 1 ساعة
7.3 Feature Flags
javascript
// backend/src/config/flags.js
module.exports = {
  WASL_DUAL_WRITE: process.env.WASL_DUAL_WRITE === 'true',
  WASL_USE_REST_V1: process.env.WASL_USE_REST_V1 === 'true',
  WASL_REALTIME_ENABLED: process.env.WASL_REALTIME_ENABLED === 'true',
  WASL_STORAGE_ENABLED: process.env.WASL_STORAGE_ENABLED === 'true',
  WASL_SCAN_ENABLED: process.env.WASL_SCAN_ENABLED === 'true',
  WASL_CANARY_PERCENT: parseInt(process.env.WASL_CANARY_PERCENT || '0')
};
8. اختبارات القبول
8.1 Smoke Tests (كل مرحلة)
bash
# 8.1.1 صحة الخدمة
curl -s https://staging.wasl.sa/health/deep | jq '.status'
# متوقع: "ok"

# 8.1.2 RLS مع 4 أدوار
for role in admin coordinator doctor beds; do
  echo "Testing $role..."
  TOKEN=$(get_test_token $role)
  curl -s -H "Authorization: Bearer $TOKEN" \
    https://staging.wasl.sa/api/v1/referrals | jq '.data | length'
done

# 8.1.3 Optimistic Locking
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "If-Match: 1" -H "Content-Type: application/json" \
  -d '{"notes":"test"}' \
  https://staging.wasl.sa/api/v1/referrals/test-id
# متوقع: 200 (إذا version=1) أو 409 (إذا version>1)

# 8.1.4 Idempotency
KEY=$(uuidgen)
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"patient_name":"test"}' \
  https://staging.wasl.sa/api/v1/referrals
# كرر الطلب بنفس KEY — متوقع: نفس الاستجابة

# 8.1.5 Realtime
# فتح متصفح → تسجيل دخول → إرسال إشعار من جهاز آخر → يجب أن يظهر خلال 2 ثانية

# 8.1.6 Storage
# رفع مرفق → انتظار scan_status='clean' → تنزيل → متوقع: 200
8.2 Load Tests (قبل Cutover 100%)
bash
# 1000 طلب متزامن على next_ref_no()
k6 run tests/load/ref-no.js
# متوقع: 0 duplicate، متوسط < 50ms، p95 < 200ms

# 100 مستخدم متزامن على /api/v1/referrals
k6 run tests/load/referrals.js
# متوقع: 0 errors، p95 < 500ms
8.3 Data Integrity Tests (بعد Backfill)
sql
-- 8.3.1 عدد الإحالات
SELECT COUNT(*) FROM referrals;
-- يجب أن يطابق: jsonb_array_length(app_state.data->'referrals')

-- 8.3.2 عدد الأحداث
SELECT COUNT(*) FROM referral_events;
-- يجب أن يطابق: مجموع jsonb_array_length(r->'timeline') لكل إحالة

-- 8.3.3 عدد المستخدمين
SELECT COUNT(*) FROM users;
-- يجب أن يطابق: jsonb_array_length(app_state.data->'users')
9. الجدول الزمني
الأسبوع	المرحلة	المخرج
1-2	1 — Shadow Read	/api/v1/* على staging
3	1 — Data Backfill	الجداول مملوءة
4	2 — Dual Write	Flag=false، كتابة في الاثنين
5	2 — Flag=true على staging	يعمل بدون كسر
6	2 — Canary 5%	مراقبة
7	3 — Cutover 25%	مراقبة
8	3 — Cutover 100%	مراقبة
9	4 — Cleanup	/api/state read-only
10-12	4 — Cleanup النهائي	حذف app_state
10. سجل التعديلات
الإصدار	التاريخ	التغيير
1.0	2026-11-27	الإصدار الأول — 4 مراحل، Adapter Layer، Feature Flags، Rollback
11. المراجع
docs/design-v1.1.md — التصميم المعدّل

docs/policies.md — سياسات RLS

docs/decisions.md — القرارات المعتمدة

Supabase Realtime: https://supabase.com/docs/guides/realtime

Supabase Storage RLS: https://supabase.com/docs/guides/storage/security/access-control

Vercel Functions limits: https://vercel.com/docs/functions/limitations

---

**نهاية الملف.**
