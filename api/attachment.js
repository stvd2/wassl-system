// Vercel Serverless Function — shared attachment storage
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream');
const streamPipeline = promisify(pipeline);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = 'attachments';
const MAX_BYTES = 15 * 1024 * 1024;

function idFrom(req) {
  const raw = req.query?.id || req.headers['x-attachment-id'];
  return String(raw || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(body);
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BYTES) throw Object.assign(new Error('الملف أكبر من 15 م.ب'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  const id = idFrom(req);
  if (!id) return send(res, 400, JSON.stringify({ error: 'معرّف المرفق غير صالح' }));
  const path = `${id}`;
  try {
    if (req.method === 'PUT' || req.method === 'POST') {
      const contentType = String(req.headers['content-type'] || 'application/octet-stream');
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'].includes(contentType.split(';')[0])) {
        return send(res, 415, JSON.stringify({ error: 'نوع الملف غير مسموح' }));
      }
      const body = await readBody(req);
      if (!body.length || body.length > MAX_BYTES) return send(res, 413, JSON.stringify({ error: 'حجم الملف غير صالح' }));
      const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: true, cacheControl: '3600' });
      if (error) throw error;
      return send(res, 200, JSON.stringify({ ok: true, id }));
    }
    if (req.method === 'GET') {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) return send(res, 404, JSON.stringify({ error: 'المرفق غير موجود' }));
      const buf = Buffer.from(await data.arrayBuffer());
      res.statusCode = 200;
      res.setHeader('Content-Type', data.type || 'application/octet-stream');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'private, no-store');
      return res.end(buf);
    }
    res.setHeader('Allow', 'GET, PUT, POST');
    return send(res, 405, JSON.stringify({ error: 'method not allowed' }));
  } catch (error) {
    console.error('[WASL] /api/attachment:', error.message);
    return send(res, error.statusCode || 500, JSON.stringify({ error: 'فشل تخزين المرفق' }));
  }
};

// Assign the config after the handler so it is not overwritten by module.exports.
module.exports.config = { api: { bodyParser: false } };
