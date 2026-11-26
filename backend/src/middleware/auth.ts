import { NextFunction, Request, Response } from 'express';
import { supabase } from '../config/env.js';
import { fail } from './response.js';
import { AuthContext, Role } from '../types/domain.js';

declare global { namespace Express { interface Request { auth?: AuthContext } } }

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(header)) return fail(res, 401, 'UNAUTHENTICATED', 'يلزم تقديم Bearer Token');
    const token = header.replace(/^Bearer\s+/i, '');
    const { data: auth, error } = await supabase.auth.getUser(token);
    if (error || !auth.user) return fail(res, 401, 'INVALID_TOKEN', 'رمز الدخول غير صالح أو منتهٍ');
    const { data: user, error: userError } = await supabase.from('users').select('id,username,employee_no,full_name,email,role,status,auth_user_id').eq('auth_user_id', auth.user.id).eq('status', 'active').maybeSingle();
    if (userError) throw userError;
    if (!user) return fail(res, 403, 'ACCOUNT_INACTIVE', 'الحساب غير نشط أو غير مربوط');
    req.auth = { user, token };
    return next();
  } catch (error) { return next(error); }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.user.role)) return fail(res, 403, 'FORBIDDEN', 'لا تملك صلاحية هذه العملية');
    return next();
  };
}
