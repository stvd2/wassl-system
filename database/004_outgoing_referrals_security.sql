-- وَصْل (Wassl) — مسودة 004 لتوافق الصادر
-- الحالة: مسودة للمراجعة فقط — لم تُطبّق على Supabase.
--
-- المرحلة الثانية لا تحتاج إلى تغيير مخطط الإنتاج لأن الصادر يُحفظ داخل
-- public.app_state.data كـ JSON، والتحقق الحساس موجود في /api/state و/api/attachment.
-- هذا الجزء الاختياري يضيف تحققاً شكلياً فقط دون حذف أو نقل أي بيانات قديمة.
-- لا يطبّق فريد الرقم الوزاري على مستوى JSON؛ ذلك يتم خادمياً داخل /api/state.

begin;

-- تأكيد أن مفتاح الصادر، عند وجوده، مصفوفة JSON. لا يلمس السجلات أو ينقلها.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_state_outgoing_referrals_array_ck'
      and conrelid = 'public.app_state'::regclass
  ) then
    alter table public.app_state
      add constraint app_state_outgoing_referrals_array_ck
      check (
        not (data ? 'outgoing_referrals')
        or jsonb_typeof(data->'outgoing_referrals') = 'array'
      ) not valid;
  end if;
end $$;

-- بعد التحقق من جميع صفوف app_state في بيئة الاختبار فقط يمكن اعتماد السطر التالي.
-- لا يُنفّذ تلقائياً ضمن هذه المسودة:
-- alter table public.app_state validate constraint app_state_outgoing_referrals_array_ck;

commit;

-- ملاحظات التطبيق الآمن لاحقاً:
-- 1) أخذ نسخة احتياطية كاملة ومراجعة constraint في بيئة اختبار منفصلة.
-- 2) تنفيذ الجزء المطلوب فقط بعد اعتماد المستخدم.
-- 3) تشغيل VALIDATE بعد فحص البيانات الموجودة.
-- 4) لا يوجد DROP أو DELETE أو UPDATE أو نقل لبيانات app_state.
