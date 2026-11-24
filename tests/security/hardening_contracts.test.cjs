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

test('legacy service-role state routes fail closed', () => {
  const source = read('backend/server.js');
  assert.match(source, /status\(410\)/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /createClient\(/);
});
