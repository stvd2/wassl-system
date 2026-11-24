'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('public registration enforces a persistent server-side rate limit', () => {
  const source = read('api/auth-requests.js');
  assert.match(source, /wasl_consume_rate_limit/);
  assert.match(source, /rate\.data !== true/);
  assert.match(source, /429/);
});

test('registration notification append is atomic in PostgreSQL, not read-modify-write', () => {
  const source = read('api/auth-requests.js');
  const migration = read('database/005_atomic_registration_and_conversations.sql');
  assert.match(source, /wasl_append_auth_notification/);
  assert.match(migration, /update public\.app_state[\s\S]*jsonb_set/);
  assert.doesNotMatch(source, /select\('data'\).*app_state/);
});

test('registration notification fails closed when app_state.main is absent', () => {
  const migration = read('database/005_atomic_registration_and_conversations.sql');
  assert.match(migration, /get diagnostics v_updated = row_count/);
  assert.match(migration, /app_state\.main is missing; registration notification was not persisted/);
});

test('rate-limit cleanup keeps a one-day minimum retention and service-role-only execution', () => {
  const migration = read('database/005_atomic_registration_and_conversations.sql');
  assert.match(migration, /wasl_cleanup_rate_limits/);
  assert.match(migration, /p_retention_seconds < 86400/);
  assert.match(migration, /revoke all on function public\.wasl_cleanup_rate_limits\(integer\)[\s\S]*to service_role/);
});

test('approval uses a compare-and-set claim and only approves a claimed request', () => {
  const source = read('api/auth-requests-approve.js');
  const migration = read('database/005_atomic_registration_and_conversations.sql');
  assert.match(migration, /'pending','processing','approved','rejected'/);
  assert.match(source, /eq\('status', 'pending'\)\.select\('id'\)/);
  assert.match(source, /eq\('status', 'processing'\)/);
  assert.match(source, /deleteUser\(createdAuthUserId\)/);
  assert.match(source, /status: 'pending'/);
});

test('approval never changes an existing Auth password during conflict handling', () => {
  const source = read('api/auth-requests-approve.js');
  assert.match(source, /if \(authUser\)[\s\S]*?return json\(res, 409/);
  assert.doesNotMatch(source, /updateUserById/);
});

test('conversation creation is a single database transaction for parent and members', () => {
  const api = read('api/conversations.js');
  const migration = read('database/005_atomic_registration_and_conversations.sql');
  assert.match(api, /rpc\('wasl_create_conversation'/);
  assert.match(migration, /create or replace function public\.wasl_create_conversation/);
  assert.match(migration, /insert into public\.conversations[\s\S]*insert into public\.conversation_members/);
  assert.match(migration, /grant execute on function public\.wasl_create_conversation[\s\S]*to service_role/);
});

test('attachment download requires an existing metadata record and matching conversation membership', () => {
  const source = read('api/attachment.js');
  assert.match(source, /if \(!conversationId\) return send/);
  assert.match(source, /isMember\(conversationId, auth\.authUser\.id\)/);
  assert.match(source, /if \(!record \|\| record\.conversation_id !== conversationId\)/);
  assert.match(source, /if \(record && record\.conversation_id !== conversationId\)/);
});

test('acceptance letters require a real outgoing referral and coordinator/admin upload', () => {
  const source = read('api/attachment.js');
  assert.match(source, /category !== 'acceptance_letter'/);
  assert.match(source, /outgoing_referrals/);
  assert.match(source, /\['coordinator', 'admin'\]\.includes\(role\)/);
  assert.match(source, /linkedId !== id/);
  assert.match(source, /ACCEPTANCE_MIME_TYPES/);
  assert.match(source, /acceptance_letters\/\$\{referralId\}\/\$\{id\}/);
  assert.match(source, /معرّف المرفق مستخدم في مرفق محادثة/);
  assert.match(source, /matchesMagic\(contentType, body\)/);
});

test('regular referral attachments use a separate verified storage context', () => {
  const api = read('api/attachment.js');
  const page = read('public/index.html');
  assert.match(api, /category !== 'referral_attachment'/);
  assert.match(api, /referrals\/\$\{referralId\}\/\$\{id\}/);
  assert.match(api, /regularReferral\(context\.referralId\)/);
  assert.match(api, /canAccessRegularReferral\(referral, auth\)/);
  assert.match(api, /function requestValue\(req, key\)/);
  assert.match(api, /new URL\(rawUrl, 'http:\/\/localhost'\)\.searchParams/);
  assert.match(api, /upsert: false/);
  assert.match(page, /attsPut\(attId, file, \{ referral_id: id, category: 'referral_attachment' \}\)/);
  assert.match(page, /function attachmentUrl\(id, context = \{\}\)/);
  assert.match(page, /context\.referral_id \? \{ referral_id: context\.referral_id \}/);
  assert.match(page, /await flushStateSync\(\)/);
});

test('chat attachments pass conversation context for upload and retrieval', () => {
  const page = read('public/index.html');
  assert.match(page, /attsPut\(attId, file, \{ conversation_id: chatId \}\)/);
  assert.match(page, /conversation_id: chatId, name: file\.name/);
  assert.match(page, /if \(meta\.conversation_id\) return \{ conversation_id: meta\.conversation_id \}/);
  assert.match(page, /String\(meta\.referral_id \|\| ''\)\.startsWith\('chat-'\)/);
  assert.match(page, /attsGet\(id, attachmentContext\(DATA\.attachments\[id\]\)\)/);
});

test('legacy service-role state routes fail closed', () => {
  const source = read('backend/server.js');
  assert.match(source, /status\(410\)/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /createClient\(/);
});
