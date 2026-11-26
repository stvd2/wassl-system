import { supabase } from '../config/env.js';
import { Referral, ReferralStatus } from '../types/domain.js';

const columns = 'id,ref_no,patient_name,patient_identifier,priority,admission_type,department_id,status,version,created_by,assigned_doctor_id,clinical_summary,diagnosis,notes,created_at,updated_at,completed_at';

export async function listReferrals(userId: string, role: string, limit: number, offset: number) {
  let query = supabase.from('referrals').select(columns, { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (role === 'doctor') query = query.eq('assigned_doctor_id', userId);
  if (role === 'beds') {
    const { data: requests, error } = await supabase.from('bed_requests').select('referral_id').eq('requested_by', userId).limit(500);
    if (error) throw error;
    const ids = (requests || []).map((row: any) => row.referral_id);
    if (!ids.length) return { data: [], count: 0 };
    query = query.in('id', ids);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data as Referral[], count: count || 0 };
}

export async function getReferral(id: string) {
  const { data, error } = await supabase.from('referrals').select(columns).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Referral | null;
}

export async function canAccessReferral(id: string, userId: string, role: string) {
  if (role === 'admin' || role === 'coordinator') return true;
  if (role === 'doctor') {
    const { data, error } = await supabase.from('referrals').select('id').eq('id', id).eq('assigned_doctor_id', userId).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
  if (role === 'beds') {
    const { data, error } = await supabase.from('bed_requests').select('id').eq('referral_id', id).limit(1);
    if (error) throw error;
    return Boolean(data?.length);
  }
  return false;
}

export async function createReferral(input: Record<string, unknown>, actorId: string) {
  const { data: refNo, error: refError } = await supabase.rpc('next_ref_no');
  if (refError) throw refError;
  const { data, error } = await supabase.from('referrals').insert({ ...input, ref_no: refNo, created_by: actorId, status: 'awaiting_doctor', version: 1 }).select(columns).single();
  if (error) throw error;
  return data as Referral;
}

export async function transitionReferral(id: string, actorId: string, input: { expected_version: number; expected_status: ReferralStatus; to_status: ReferralStatus; notes?: string; request_id?: string }) {
  const { data, error } = await supabase.rpc('wasl_transition_referral_v1', { p_referral_id: id, p_expected_version: input.expected_version, p_expected_status: input.expected_status, p_to_status: input.to_status, p_notes: input.notes || null, p_request_id: input.request_id || null });
  if (error) throw error;
  return data as Referral;
}

export async function listEvents(id: string) {
  const { data, error } = await supabase.from('referral_v1_events').select('id,referral_id,actor_id,from_status,to_status,action,notes,details,created_at').eq('referral_id', id).order('created_at', { ascending: true }).limit(500);
  if (error) throw error;
  return data || [];
}
