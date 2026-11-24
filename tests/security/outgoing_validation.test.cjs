const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOutgoingState } = require('../../api/outgoing-validation');
const base = item => ({meta:{version:'v6'},attachments:{},outgoing_referrals:[{id:'OUT-1',case_type:'إنقاذ حياة',ministerial_code:'LIFE-1',...item}]});
test('rejects life-saving outgoing referral without ministry code',()=>assert.throws(()=>validateOutgoingState(base({ministerial_code:''})),/الكود الوزاري/));
test('rejects duplicate ministry referral numbers case-insensitively',()=>assert.throws(()=>validateOutgoingState({attachments:{},outgoing_referrals:[{id:'OUT-1',case_type:'عادية',ministerial_ref_no:'MIN-1'},{id:'OUT-2',case_type:'عادية',ministerial_ref_no:'min-1'}]}),/مكرر/));
test('accepts valid acceptance letter metadata',()=>assert.doesNotThrow(()=>validateOutgoingState({attachments:{'ATT-1':{category:'acceptance_letter',referral_id:'OUT-1',mime_type:'application/pdf',size:1024,uploaded_by:'coord',uploaded_at:'2026-01-01T00:00:00Z'}},outgoing_referrals:[{id:'OUT-1',case_type:'عادية',acceptance_letter_attachment_id:'ATT-1'}]})));
test('rejects invalid acceptance letter metadata',()=>assert.throws(()=>validateOutgoingState({attachments:{'ATT-1':{category:'acceptance_letter',referral_id:'OUT-1',mime_type:'text/plain',size:1024,uploaded_by:'coord',uploaded_at:'2026-01-01'}},outgoing_referrals:[{id:'OUT-1',case_type:'عادية',acceptance_letter_attachment_id:'ATT-1'}]}),/نوع خطاب/));
