import { Router } from 'express';
import { supabase } from '../config/env.js';
import { ok, fail } from '../middleware/response.js';

export const healthRouter = Router();
healthRouter.get('/health', (_req, res) => ok(res, { service: 'wassl-backend', version: 'v1.1', status: 'ok' }));
healthRouter.get('/health/deep', async (_req, res, next) => {
  try {
    const started = Date.now();
    const { error } = await supabase.from('departments').select('id', { count: 'exact', head: true });
    if (error) return fail(res, 503, 'DATABASE_UNAVAILABLE', 'قاعدة البيانات غير متاحة');
    return ok(res, { service: 'wassl-backend', version: 'v1.1', status: 'ok', database: 'ok', latency_ms: Date.now() - started });
  } catch (error) { return next(error); }
});
healthRouter.get('/metrics', (_req, res) => ok(res, { requests_total: null, note: 'metrics collector not configured' }));
