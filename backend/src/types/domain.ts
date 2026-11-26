export type Role = 'admin' | 'coordinator' | 'doctor' | 'beds';
export type UserStatus = 'pending' | 'active' | 'rejected' | 'disabled';
export type ReferralStatus =
  | 'awaiting_doctor' | 'info_requested' | 'resubmitted' | 'consultation_done'
  | 'doctor_accepted' | 'doctor_rejected' | 'awaiting_bed' | 'bed_approved'
  | 'bed_rejected' | 'completed';

export interface WaslUser {
  id: string; username: string; employee_no: string | null; full_name: string;
  email: string | null; role: Role; status: UserStatus; auth_user_id: string | null;
}

export interface AuthContext {
  user: WaslUser;
  token: string;
}

export interface Referral {
  id: string; ref_no: string; patient_name: string; patient_identifier: string | null;
  priority: string; admission_type: string; department_id: string; status: ReferralStatus;
  version: number; created_by: string; assigned_doctor_id: string | null;
  clinical_summary: string | null; diagnosis: string | null; notes: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}

export interface TransitionInput {
  to_status: ReferralStatus;
  notes?: string;
  expected_status: ReferralStatus;
  expected_version: number;
}
