'use strict';

const { admin } = require('./_auth');

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(JSON.stringify(payload));
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return null; }
  }
  return null;
}

function uuid(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : '';
}

function conversationId(req, body = {}) {
  return uuid(req.query?.conversation_id || req.query?.id || req.headers['x-conversation-id'] || body.conversation_id || body.conversationId);
}

async function isMember(conversationIdValue, userId) {
  const { data, error } = await admin
    .from('conversation_members')
    .select('conversation_id')
    .eq('conversation_id', conversationIdValue)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function conversationForMember(conversationIdValue, userId) {
  if (!conversationIdValue || !(await isMember(conversationIdValue, userId))) return null;
  const { data, error } = await admin.from('conversations').select('id, conversation_type, title, created_by, created_at, updated_at').eq('id', conversationIdValue).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function membersFor(conversationIdValue) {
  const { data, error } = await admin
    .from('conversation_members')
    .select('conversation_id, user_id, member_role, joined_at')
    .eq('conversation_id', conversationIdValue)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

module.exports = { admin, bodyOf, conversationId, conversationForMember, isMember, membersFor, sendJson, uuid };
