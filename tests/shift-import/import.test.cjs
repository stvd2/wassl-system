'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = path.join(__dirname, '../../public/shift-import');
global.XLSX = require(path.join(base, 'vendor/xlsx.full.min.js'));
const {parse} = require(path.join(base, 'shift-import.js'));
const users = [
  {id:'u1',username:'101',full_name:'أحمد علي',role:'doctor',active:true},
  {id:'u2',username:'102',full_name:'سارة حسن',role:'coordinator',active:true},
  {id:'u3',username:'103',full_name:'احمد علي',role:'doctor',active:true,department:'الطوارئ'},
  {id:'u4',username:'104',full_name:'غير نشط',role:'doctor',active:false},
  {id:'u5',username:'105',full_name:'معلق',role:'doctor',active:true,pending_approval:true},
  {id:'u6',username:'106',full_name:'مرفوض',role:'doctor',active:true,rejected:true}
];
function csv(data) { return new File([data], 'test.csv', {type:'text/csv'}); }
async function fromCsv(content, list=users) { return parse(csv(content),list); }
function one(r) { assert.equal(r.rows.length,1,JSON.stringify(r)); return r.rows[0]; }

test('Arabic UTF-8 headers, Arabic numerals, semicolon delimiter and exact username', async () => {
  const r=await fromCsv('التاريخ;الفترة;الرقم الوظيفي;الدور;ملاحظات\n٢٠٢٦-١١-٢٥;صباحية;102;منسق;"قسم; الطوارئ"');
  const x=one(r);
  assert.deepEqual([x.status,x.date,x.shift,x.user_id,x.user_name,x.role,x.notes], ['ready','2026-11-25','صباحي','u2','سارة حسن','coordinator','قسم; الطوارئ']);
  assert.deepEqual(r.errors,[]);
});
test('English date with month name and DMY unambiguous, and quoted CSV', async () => {
  const r=await fromCsv('Date,Shift,Name,Notes\nNovember 25,2026,Morning,wrong');
  // The comma must be quoted; malformed columns are never silently repaired.
  assert.notEqual(one(r).status,'ready');
  const r2=await fromCsv('Date,Shift,Name,Notes\n"November 25, 2026",Morning,سارة حسن,"line one\nline two"\n25/12/2026,Night,سارة حسن,"a, b"');
  assert.deepEqual(r2.rows.map(x => [x.date,x.shift,x.status]),[['2026-11-25','صباحي','ready'],['2026-12-25','ليلي','ready']]);
  assert.equal(r2.rows[0].notes,'line one\nline two');
});
test('Arabic Gregorian month names with variants and non-Arabic numerals', async () => {
  const r=await fromCsv('التاريخ,الفترة,اسم المستخدم\n٢٥ آذار ٢٠٢٦,مسائي,سارة حسن\n٢٥ كانون الأول ٢٠٢٦,ليلي,سارة حسن');
  assert.deepEqual(r.rows.map(x=>x.date),['2026-03-25','2026-12-25']);
  assert.ok(r.rows.every(x=>x.status==='ready'));
});
test('ambiguous numeric date never guessed', async () => {
  const x=one(await fromCsv('date,shift,name\n03/04/2026,morning,سارة حسن'));
  assert.equal(x.date,null); assert.equal(x.status,'needs_review'); assert.equal(x.ambiguous,true);
  assert.deepEqual(x.date_candidates,['2026-04-03','2026-03-04']);
});
test('duplicate normalized names are ambiguous and expose only safe candidate fields', async () => {
  const x=one(await fromCsv('date,shift,name\n2026-11-25,morning,أحمد علي'));
  assert.equal(x.ambiguous,true); assert.equal(x.user_id,null); assert.equal(x.candidates.length,2);
  assert.deepEqual(Object.keys(x.candidates[0]).sort(),['department','full_name','id','role']);
});
test('user ID and employee number disambiguate, conflicting fields are blocked', async () => {
  let x=one(await fromCsv('date,shift,user id,name\n2026-11-25,night,u1,أحمد علي'));
  assert.equal(x.status,'ready'); assert.equal(x.user_id,'u1');
  x=one(await fromCsv('date,shift,user id,name,role\n2026-11-25,night,u1,سارة حسن,coordinator'));
  assert.equal(x.status,'needs_review'); assert.ok(x.errors.some(s=>s.includes('الاسم'))); assert.ok(x.errors.some(s=>s.includes('الدور')));
  x=one(await fromCsv('date,shift,user id,name\n2026-11-25,night,wrong,سارة حسن'));
  assert.equal(x.user_id,null); assert.ok(x.errors.some(s=>s.includes('لم يُعثر')));
});
test('inactive, pending and rejected users are not matched', async () => {
  for(const name of ['غير نشط','معلق','مرفوض']) {
    const x=one(await fromCsv(`date,shift,name\n2026-11-25,morning,${name}`));
    assert.equal(x.user_id,null); assert.equal(x.status,'needs_review');
  }
});
test('invalid date, role, shift, unsupported year and missing user remain reviewable', async () => {
  const x=one(await fromCsv('date,shift,user id,role\n2026-02-30,unknown,u2,nurse'));
  assert.equal(x.status,'needs_review'); assert.equal(x.errors.length,3);
  assert.equal(one(await fromCsv('date,shift,name\n1447-04-15,night,سارة حسن')).date,null);
  assert.equal(one(await fromCsv('date,shift,name\n2026-11-25,night,')).status,'needs_review');
});
test('exact duplicate rows flagged for explicit review', async () => {
  const r=await fromCsv('Date,Shift,Name\n2026-11-25,Morning,سارة حسن\n2026-11-25,Morning,سارة حسن');
  assert.equal(r.rows.length,2); assert.ok(r.rows.every(x => x.status==='needs_review' && x.errors.some(e=>e.includes('مكررة'))));
});
test('repeated headers; rows with absent required fields are not discarded', async () => {
  const r=await fromCsv('Report,,\nDate,Shift,Name\n2026-11-25,Morning,سارة حسن\nDate,Shift,Name\n2026-11-26,,سارة حسن');
  assert.deepEqual(r.rows.map(x=>x.status),['ready','needs_review']); assert.equal(r.rows[1].source.row,5);
});
test('duplicate headers and missing headers cause global errors', async () => {
  let r=await fromCsv('Date,Date,Shift,Name\n2026-11-25,2026-11-25,Morning,سارة حسن');
  assert.equal(r.rows.length,0); assert.ok(r.errors.length);
  r=await fromCsv('nonsense,random\n1,2'); assert.equal(r.rows.length,0); assert.ok(r.errors.length);
});
test('invalid encodings, CSV quoting, unsupported formats, and invalid users fail closed', async () => {
  assert.ok((await parse(new File([new Uint8Array([0xff])],'bad.csv'),users)).errors.length);
  assert.ok((await fromCsv('date,shift,name\n"2026-11-25,morning,سارة حسن')).errors.length);
  assert.ok((await parse(new File(['hello'],'bad.txt'),users)).errors.length);
  assert.ok((await parse(csv(''),null)).errors.length);
});
test('real XLSX and XLS files, date serial values, sheets, and row numbers', async () => {
  for(const bookType of ['xlsx','xls']) {
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet([['heading'],['Date','Shift','Employee ID','Notes'],[46351,'Evening','102','ICU']]);
    ws.A3.z='yyyy-mm-dd';
    XLSX.utils.book_append_sheet(wb,ws,'Schedule');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['unrelated']]),'Other');
    const bytes=XLSX.write(wb,{type:'buffer',bookType});
    const r=await parse(new File([bytes],`test.${bookType}`),users);
    const x=one(r); assert.equal(x.status,'ready',JSON.stringify(r));
    assert.deepEqual([x.date,x.shift,x.user_id,x.notes,x.source.sheet,x.source.row],['2026-11-25','مسائي','u2','ICU','Schedule',3]);
    assert.ok(r.warnings.some(w=>w.source.sheet==='Other'));
  }
});
test('Excel 1904 date system is respected', async () => {
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet([['Date','Shift','Employee ID'],[44935,'Morning','102']]);
  ws.A2.z='yyyy-mm-dd';
  XLSX.utils.book_append_sheet(wb,ws,'S');
  wb.Workbook={WBProps:{date1904:true}};
  const r=await parse(new File([XLSX.write(wb,{type:'buffer',bookType:'xlsx'})],'date.xlsx'),users);
  const x=one(r); assert.equal(x.date,'2027-01-10'); assert.equal(x.status,'ready');
});
test('unformatted Excel number and formula cells require review', async () => {
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet([['Date','Shift','Employee ID'],[46351,'Morning','102']]);
  ws.B2.f='"Morning"';
  XLSX.utils.book_append_sheet(wb,ws,'S');
  const r=await parse(new File([XLSX.write(wb,{type:'buffer',bookType:'xlsx'})],'date.xlsx'),users);
  const x=one(r); assert.equal(x.date,null); assert.equal(x.status,'needs_review');
  assert.ok(x.errors.some(e=>e.includes('غير منسق'))); assert.ok(x.errors.some(e=>e.includes('صيغة')));
});
