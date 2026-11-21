// Vercel Serverless Function — نقطة /api/state (GET/PUT/POST/DELETE) — CommonJS
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { gzip } = require('node:zlib');
const { promisify } = require('node:util');
const gzipAsync = promisify(gzip);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STATE_ID = 'main';
const CACHE_TTL_MS = 250;
let stateCache;
let stateCacheAt = 0;
let stateCacheReady = false;
let stateReadPromise = null;

function invalidateStateCache() {
  stateCache = undefined;
  stateCacheAt = 0;
  stateCacheReady = false;
}

async function readState() {
  const now = Date.now();
  if (stateCacheReady && now - stateCacheAt < CACHE_TTL_MS) return { value: stateCache, cache: 'hit' };
  if (!stateReadPromise) {
    stateReadPromise = (async () => {
      const { data, error } = await supabase.from('app_state').select('data').eq('id', STATE_ID).maybeSingle();
      if (error) throw error;
      const value = data ? data.data : null;
      stateCache = value;
      stateCacheAt = Date.now();
      stateCacheReady = true;
      return value;
    })().finally(() => { stateReadPromise = null; });
  }
  return { value: await stateReadPromise, cache: 'miss' };
}

async function sendJson(req, res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (acceptsGzip && body.length >= 1024) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.end(await gzipAsync(body));
  } else res.end(body);
}

function expectedRevision(payload) {
  const value = payload?.meta?.sync_revision;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

module.exports = async function handler(req, res) {
  const { method } = req;
  try {
    if (method === 'GET') {
      const result = await readState();
      res.setHeader('X-Wasl-State-Cache', result.cache);
      return sendJson(req, res, 200, result.value);
    }
    if (method === 'PUT' || method === 'POST') {
      const payload = req.body;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendJson(req, res, 400, { error: 'body غير صالح' });
      const { data: result, error } = await supabase.rpc('save_app_state', {
        expected_revision: expectedRevision(payload),
        next_data: payload
      });
      if (error) throw error;
      if (!result?.ok) {
        return sendJson(req, res, 409, { error: 'تعارض مزامنة: توجد نسخة أحدث على جهاز آخر', conflict: true, current_revision: result?.current_revision ?? null });
      }
      invalidateStateCache();
      return sendJson(req, res, 200, { ok: true, data: result.data, revision: result.revision });
    }
    if (method === 'DELETE') {
      const { error } = await supabase.from('app_state').delete().eq('id', STATE_ID);
      if (error) throw error;
      invalidateStateCache();
      return sendJson(req, res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, PUT, POST, DELETE');
    return sendJson(req, res, 405, { error: 'method not allowed' });
  } catch (error) {
    console.error('[WASL] /api/state:', error.message);
    return sendJson(req, res, 500, { error: 'Supabase request failed' });
  }
};
