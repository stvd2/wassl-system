const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
test('v1 layered backend structure exists', () => {
  for (const file of [
    'backend/src/app.ts', 'backend/src/server.ts',
    'backend/src/middleware/auth.ts', 'backend/src/middleware/response.ts',
    'backend/src/routes/health.routes.ts', 'backend/src/routes/referral.routes.ts',
    'database/migrations/018_wasl_v1_1_workflow_hardening.sql',
    'api/v1.js'
  ]) assert.equal(fs.existsSync(path.join(root, file)), true, file);
});

test('v1 Vercel adapter forwards rewritten routes to the backend app', () => {
  const adapterPath = path.join(root, 'api/v1.js');
  const source = fs.readFileSync(adapterPath, 'utf8');

  assert.match(source, /import\(['"]\.\.\/backend\/dist\/app\.js['"]\)/);
  assert.match(source, /searchParams\.get\(['"]__route['"]\)/);
  assert.match(source, /req\.url\s*=\s*`\/api\/v1/);
  assert.match(source, /res\.status\(500\)\.json/);
});

test('v1 does not use app_state in backend source', () => {
  const files = fs.readdirSync(path.join(root, 'backend/src'), { recursive: true }).filter(file => String(file).endsWith('.ts'));
  const source = files.map(file => fs.readFileSync(path.join(root, 'backend/src', file), 'utf8')).join('\n');
  assert.equal(source.includes('app_state'), false);
  assert.equal(source.includes('user_profiles'), false);
});
