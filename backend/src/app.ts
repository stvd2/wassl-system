import express from 'express';
import cors from 'cors';
import { requestContext, errorHandler } from './middleware/request-context.js';
import { healthRouter } from './routes/health.routes.js';
import { referralRouter } from './routes/referral.routes.js';
import { fail } from './middleware/response.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestContext);
  app.use('/api/v1', healthRouter);
  app.use('/api', healthRouter);
  app.use('/', healthRouter);
  app.use('/api/v1', referralRouter);
  app.use('/api/v1', (_req, res) => fail(res, 404, 'NOT_FOUND', 'المسار غير موجود'));
  app.use(errorHandler);
  return app;
}
