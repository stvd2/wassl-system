const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('public/index.html', 'utf8');

assert.match(html, /wasl_makkah_lang/);
assert.match(html, /document\.documentElement\.dir=lang==='en'\?'ltr':'rtl'/);
assert.match(html, /function setLanguage\(lang\)/);
assert.match(html, /function labelFor\(key, fallback\)/);
assert.match(html, /function renderVerbatim\(value/);
assert.match(html, /unicode-bidi:isolate/);
assert.match(html, /dir=\\?"auto\\?"/);
assert.match(html, /function syncPrintDocument\(doc\)/);
assert.match(html, /syncPrintDocument\(w\.document\)/);
assert.match(html, /WASL_I18N\.storageKey/);
// Internal workflow values remain Arabic legacy keys; only display labels are localized.
assert.match(html, /const OUTGOING_TYPES = \['عادية','عيادات','طارئة','إنقاذ حياة'\]/);
assert.match(html, /const OUTGOING_STATES = \{/);
assert.match(html, /const roleLabel = r =>/);
console.log('i18n contract tests: PASS');
