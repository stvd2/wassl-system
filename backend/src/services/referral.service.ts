import { canAccessReferral, createReferral, getReferral, listEvents, listReferrals, transitionReferral } from '../repositories/referral.repository.js';
import { AuthContext, ReferralStatus, TransitionInput } from '../types/domain.js';

const statuses = new Set<ReferralStatus>(['awaiting_doctor','info_requested','resubmitted','consultation_done','doctor_accepted','doctor_rejected','awaiting_bed','bed_approved','bed_rejected','completed']);

export async function getReferralList(auth: AuthContext, limit: number, offset: number) { return listReferrals(auth.user.id, auth.user.role, limit, offset); }
export async function getReferralById(auth: AuthContext, id: string) {
  const item = await getReferral(id);
  if (!item) return null;
  if (!(await canAccessReferral(id, auth.user.id, auth.user.role))) throw Object.assign(new Error('لا تملك صلاحية هذه الإحالة'), { status: 403, code: 'FORBIDDEN' });
  return item;
}
export async function createNewReferral(auth: AuthContext, input: Record<string, unknown>) {
  for (const key of ['patient_name', 'priority', 'admission_type', 'department_id']) if (!String(input[key] || '').trim()) throw Object.assign(new Error(`الحقل ${key} مطلوب`), { status: 400, code: 'VALIDATION_ERROR' });
  if (!['admin', 'coordinator'].includes(auth.user.role)) throw Object.assign(new Error('إنشاء الإحالة متاح للمنسق أو المدير'), { status: 403, code: 'FORBIDDEN' });
  return createReferral(input, auth.user.id);
}
export async function transition(auth: AuthContext, id: string, input: TransitionInput, requestId: string) {
  if (!statuses.has(input.to_status) || !statuses.has(input.expected_status)) throw Object.assign(new Error('حالة انتقال غير صالحة'), { status: 400, code: 'INVALID_STATUS' });
  if (!Number.isInteger(input.expected_version) || input.expected_version < 1) throw Object.assign(new Error('expected_version غير صالح'), { status: 400, code: 'INVALID_VERSION' });
  return transitionReferral(id, auth.user.id, { ...input, request_id: requestId });
}
export { listEvents };
