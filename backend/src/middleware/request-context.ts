import { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const id = String(req.header('X-Request-Id') || crypto.randomUUID()).slice(0, 120);
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function errorHandler(error: any, _req: Request, res: Response, _next: NextFunction) {
  console.error('[wasl-v1]', res.locals.requestId, error?.message || error);
  if (res.headersSent) return;
  const status = Number(error?.status || 500);
  return res.status(status).json({ success: false, error: { code: error?.code || 'INTERNAL_ERROR', message: status >= 500 ? 'حدث خطأ داخلي' : String(error.message) } });
}
