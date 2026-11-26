import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { fail, ok } from '../middleware/response.js';
import { createNewReferral, getReferralById, getReferralList, listEvents, transition } from '../services/referral.service.js';

export const referralRouter = Router();
referralRouter.use(requireAuth);
referralRouter.get('/referrals', async (req, res, next) => { try { const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100); const offset = Math.max(Number(req.query.offset) || 0, 0); const result = await getReferralList(req.auth!, limit, offset); return ok(res, result.data, 200, { limit, offset, total: result.count }); } catch (e) { next(e); } });
referralRouter.post('/referrals', requireRole('admin', 'coordinator'), async (req, res, next) => { try { return ok(res, await createNewReferral(req.auth!, req.body || {}), 201); } catch (e) { next(e); } });
referralRouter.get('/referrals/:id', async (req, res, next) => { try { const item = await getReferralById(req.auth!, req.params.id); return item ? ok(res, item) : fail(res, 404, 'NOT_FOUND', 'الإحالة غير موجودة'); } catch (e) { next(e); } });
referralRouter.get('/referrals/:id/events', async (req, res, next) => { try { return ok(res, await listEvents(req.params.id)); } catch (e) { next(e); } });
referralRouter.post('/referrals/:id/transitions', async (req, res, next) => { try { return ok(res, await transition(req.auth!, req.params.id, req.body, res.locals.requestId)); } catch (e) { next(e); } });
