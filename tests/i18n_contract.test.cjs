const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const read = file => fs.readFileSync(file, 'utf8');
const html = read('public/index.html');

assert.match(html, /wasl_makkah_lang/);
assert.match(html, /تجمع مكة المكرمة الصحي/);
assert.match(html, /MAKKAH HEALTH CLUSTER/);
assert.doesNotMatch(html, /HAIL HEALTH CLUSTER|التجمع الصحي بحائل/);
assert.match(html, /document\.documentElement\.dir=lang==='en'\?'ltr':'rtl'/);
assert.match(html, /function setLanguage\(lang\)/);
assert.match(html, /function labelFor\(key, fallback\)/);
assert.match(html, /function renderVerbatim\(value/);
assert.match(html, /unicode-bidi:isolate/);
assert.match(html, /dir=\\?"auto\\?"/);
assert.match(html, /function syncPrintDocument\(doc\)/);
assert.match(html, /syncPrintDocument\(w\.document\)/);
assert.match(html, /function tState\(code\)/);
assert.match(html, /function tAction\(key\)/);
assert.match(html, /function tOutgoingState\(code\)/);
assert.match(html, /function tBedStatus\(code\)/);
assert.match(html, /function tShiftType\(type\)/);
assert.match(html, /toLocaleString\(WASL_LANG === 'en' \? 'en-US' : 'ar-SA'/);
assert.match(html, /WASL_EN\.states/);
assert.match(html, /WASL_EN\.actions/);
// Internal workflow values remain legacy keys; only display labels are localized.
assert.match(html, /const OUTGOING_TYPES = \['عادية','عيادات','طارئة','إنقاذ حياة'\]/);
assert.match(html, /const OUTGOING_STATES = \{/);
assert.match(html, /const roleLabel = r =>/);
test('i18n storage key remains stable', () => {
  const html = read('public/index.html');
  assert.match(html, /WASL_I18N\.storageKey/);
});
console.log('i18n contract tests: PASS');
