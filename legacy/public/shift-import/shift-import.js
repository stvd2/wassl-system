/* Wasl local shift import. No data leaves the browser; no persistence. */
(function (root) {
  'use strict';

  const scriptBase = typeof document !== 'undefined' && document.currentScript && document.currentScript.src
    ? new URL('.', document.currentScript.src).href : null;
  const MAX_BYTES = 15 * 1024 * 1024;
  const MAX_ROWS = 20000;
  const MAX_COLS = 100;
  const MAX_PAGES = 200;
  const ROLE_VALUES = ['coordinator', 'doctor', 'beds', 'admin'];

  function norm(value) {
    return String(value == null ? '' : value).normalize('NFKC')
      .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[\u0660-\u0669]/g, c => String(c.charCodeAt(0) - 0x0660))
      .replace(/[\u06f0-\u06f9]/g, c => String(c.charCodeAt(0) - 0x06f0))
      .toLowerCase().replace(/[\s\u00a0_\-]+/g, ' ').trim();
  }
  const aliases = {
    date: ['التاريخ','تاريخ','تاريخ المناوبة','تاريخ المناوبه','تاريخ الوردية','date','shift date','duty date'],
    shift: ['الفترة','الفتره','فترة','الوردية','الورديه','المناوبة','المناوبه','نوع المناوبة','shift','period','shift period','duty'],
    user_name: ['الاسم','الاسم الكامل','اسم','اسم الموظف','اسم المناوب','اسم المستخدم','المستخدم','الموظف','المناوب','name','full name','employee name','staff name','user name','person'],
    user_id: ['معرف المستخدم','معرف الموظف','رقم المستخدم','user id','userid'],
    username: ['اسم الدخول','رقم الموظف','الرقم الوظيفي','رقم وظيفي','رقم الموظف الوظيفي','username','employee id','employee number','staff id','staff number'],
    role: ['الدور','دور','الوظيفة','الوظيفه','role','position'],
    notes: ['ملاحظات','الملاحظات','ملاحظة','ملاحظه','notes','note','remarks','remark']
  };
  const headerLookup = Object.create(null);
  for (const [field, words] of Object.entries(aliases)) for (const word of words) headerLookup[norm(word)] = field;
  function headerField(value) { return headerLookup[norm(value)] || null; }
  const shifts = Object.create(null);
  for (const [canonical, words] of Object.entries({
    'صباحي': ['صباحي','صباح','صباحية','الصباحية','morning','am','day','day shift'],
    'مسائي': ['مسائي','مساء','مسائية','المسائية','evening','evening shift','pm'],
    'ليلي': ['ليلي','ليل','ليلة','ليليه','الليلية','night','night shift','overnight']
  })) for (const word of words) shifts[norm(word)] = canonical;
  const roles = Object.create(null);
  for (const [canonical, words] of Object.entries({
    coordinator: ['coordinator','منسق','منسق الإحالات','منسق الاحالات'],
    doctor: ['doctor','physician','طبيب','طبيبة','دكتور','دكتورة'],
    beds: ['beds','bed management','إدارة أسرة','إدارة الأسرة','ادارة الاسرة'],
    admin: ['admin','administrator','مدير','مدير النظام']
  })) for (const word of words) roles[norm(word)] = canonical;
  const months = Object.create(null);
  [
    ['january','jan','يناير','كانون الثاني'], ['february','feb','فبراير','شباط'],
    ['march','mar','مارس','آذار'], ['april','apr','أبريل','ابريل','نيسان'],
    ['may','مايو','أيار'], ['june','jun','يونيو','حزيران'],
    ['july','jul','يوليو','تموز'], ['august','aug','أغسطس','اغسطس','آب'],
    ['september','sep','sept','سبتمبر','أيلول'], ['october','oct','أكتوبر','اكتوبر','تشرين الأول'],
    ['november','nov','نوفمبر','تشرين الثاني'], ['december','dec','ديسمبر','كانون الأول']
  ].forEach((list, i) => list.forEach(word => { months[norm(word)] = i + 1; }));

  function iso(y, m, d) {
    if (!Number.isInteger(y) || y < 1900 || y > 2100 || !Number.isInteger(m) || !Number.isInteger(d)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
      ? `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null;
  }
  function parseDate(value, date1904) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (!root.XLSX || !root.XLSX.SSF) return {error:'مكتبة قراءة تاريخ Excel غير متاحة'};
      const code = root.XLSX.SSF.parse_date_code(value, {date1904: !!date1904});
      const out = code && iso(code.y, code.m, code.d);
      return out ? {value:out} : {error:'تاريخ Excel غير صالح'};
    }
    // norm folds hyphens for name/header matching; first preserve date separators.
    const text = norm(String(value == null ? '' : value).replace(/-/g, '/')).replace(/[،,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return {error:'التاريخ مطلوب'};
    let match = text.match(/^(\d{4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})$/);
    if (match) {
      const out = iso(+match[1], +match[2], +match[3]);
      return out ? {value:out} : {error:'التاريخ غير صالح أو خارج نطاق التقويم الميلادي المدعوم'};
    }
    match = text.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})$/);
    if (match) {
      const a = +match[1], b = +match[2], y = +match[3];
      const dmy = iso(y, b, a), mdy = iso(y, a, b);
      if (dmy && mdy && dmy !== mdy) return {error:'التاريخ ملتبس بين يوم/شهر وشهر/يوم؛ استخدم YYYY-MM-DD', ambiguous:true, candidates:[dmy,mdy]};
      const out = dmy || mdy;
      return out ? {value:out} : {error:'التاريخ غير صالح أو خارج نطاق التقويم الميلادي المدعوم'};
    }
    const words = text.replace(/\./g, '').split(' ').filter(Boolean);
    if (words.length >= 3 && words.length <= 4) {
      let day, year, monthName;
      if (/^\d{1,2}$/.test(words[0]) && /^\d{4}$/.test(words[words.length-1])) {
        day = +words[0]; year = +words[words.length-1]; monthName = words.slice(1,-1).join(' ');
      } else if (/^\d{1,2}$/.test(words[words.length-2]) && /^\d{4}$/.test(words[words.length-1])) {
        day = +words[words.length-2]; year = +words[words.length-1]; monthName = words.slice(0,-2).join(' ');
      }
      const m = months[monthName];
      if (m && day && year) {
        const out = iso(year, m, day);
        return out ? {value:out} : {error:'التاريخ المكتوب غير صالح'};
      }
    }
    return {error:'تعذر فهم التاريخ؛ استخدم تاريخًا ميلاديًا مثل 2026-03-25'};
  }

  function findHeader(cells) {
    const map = Object.create(null), duplicates = [];
    cells.forEach((cell, i) => {
      const key = headerField(cell);
      if (!key) return;
      if (map[key] !== undefined) duplicates.push(key); else map[key] = i;
    });
    if (map.date === undefined || map.shift === undefined ||
        (map.user_name === undefined && map.user_id === undefined && map.username === undefined)) return null;
    return {map, duplicates};
  }
  function extractRaw(cells, map) {
    const raw = {};
    for (const [field, i] of Object.entries(map)) raw[field] = cells[i] == null ? '' : cells[i];
    return raw;
  }
  function str(value) { return String(value == null ? '' : value).trim(); }
  function slim(u) { return {id:u.id, full_name:u.full_name, role:u.role, department:u.department || ''}; }
  function makeRow(raw, source, users, date1904) {
    const row = {date:null, shift:null, user_id:null, user_name:str(raw.user_name), role:null,
      notes:str(raw.notes), source, raw, status:'needs_review', ambiguous:false, errors:[], candidates:[], date_candidates:[]};
    const date = parseDate(raw.date, date1904);
    if (date.error) row.errors.push(date.error); else row.date = date.value;
    if (date.ambiguous) { row.ambiguous = true; row.date_candidates = date.candidates; }
    row.shift = shifts[norm(raw.shift)] || null;
    if (!row.shift) row.errors.push(str(raw.shift) ? `الفترة غير معروفة: ${str(raw.shift)}` : 'الفترة مطلوبة');

    let specifiedRole = null;
    if (str(raw.role)) {
      specifiedRole = roles[norm(raw.role)] || null;
      if (!specifiedRole) row.errors.push(`الدور غير معروف: ${str(raw.role)}`);
    }
    const eligible = users.filter(u => u && u.active && !u.pending_approval && !u.rejected);
    let matches = [];
    if (str(raw.user_id)) matches = eligible.filter(u => str(u.id) === str(raw.user_id));
    else if (str(raw.username)) matches = eligible.filter(u => norm(u.username) === norm(raw.username));
    else if (str(raw.user_name)) matches = eligible.filter(u => norm(u.full_name) === norm(raw.user_name));
    if (!str(raw.user_id) && !str(raw.username) && !str(raw.user_name)) row.errors.push('المستخدم مطلوب');
    else if (matches.length === 0) row.errors.push('لم يُعثر على مستخدم نشط مطابق تمامًا للمعرّف أو الاسم');
    else if (matches.length > 1) {
      row.ambiguous = true; row.candidates = matches.map(slim);
      row.errors.push('يوجد أكثر من مستخدم مطابق؛ يلزم الاختيار يدويًا');
    } else {
      const u = matches[0];
      if (u.id === undefined || u.id === null || !str(u.id)) row.errors.push('المستخدم المطابق بلا معرّف صالح');
      else { row.user_id = u.id; row.user_name = str(u.full_name); }
      if (!str(u.full_name)) row.errors.push('المستخدم المطابق بلا اسم كامل صالح');
      if (str(raw.user_name) && norm(raw.user_name) !== norm(u.full_name)) row.errors.push('الاسم لا يطابق المستخدم المحدد بالمعرّف');
      if (str(raw.username) && norm(raw.username) !== norm(u.username)) row.errors.push('رقم الموظف لا يطابق المستخدم المحدد بالمعرّف');
      if (specifiedRole && specifiedRole !== u.role) row.errors.push('الدور في الملف لا يطابق دور المستخدم الحالي');
      row.role = specifiedRole || u.role || null;
      if (!ROLE_VALUES.includes(row.role)) row.errors.push('دور المستخدم غير صالح للمناوبات');
    }
    if (!row.role && specifiedRole) row.role = specifiedRole;
    if (row.errors.length === 0) row.status = 'ready';
    return row;
  }

  function addMatrix(matrix, result, source, users, date1904, inspectCells) {
    let header = null, found = false;
    for (let i = 0; i < matrix.length; i++) {
      const cells = matrix[i] || [];
      if (cells.length > MAX_COLS) throw new Error(`تجاوز عدد الأعمدة الحد ${MAX_COLS}`);
      if (!cells.some(c => str(c))) continue;
      const nextHeader = findHeader(cells);
      if (nextHeader) {
        found = true;
        header = nextHeader;
        if (header.duplicates.length) {
          result.errors.push({source:{...source, row:i+1}, message:`أعمدة مكررة: ${header.duplicates.join('، ')}؛ تعذرت معالجة هذا الجدول بأمان`});
          header = null;
        }
        continue;
      }
      if (!header) continue;
      const raw = extractRaw(cells, header.map);
      if (!Object.values(raw).some(v => str(v))) continue;
      if (result.rows.length >= MAX_ROWS) throw new Error(`تجاوز الملف الحد ${MAX_ROWS} صفًا`);
      const row = makeRow(raw, {...source, row:i+1}, users, date1904);
      if (inspectCells) inspectCells(row, header.map, i);
      if (row.errors.length) row.status = 'needs_review';
      result.rows.push(row);
    }
    if (!found) result.warnings.push({source, message:'لم يُعثر على صف عناوين يضم التاريخ والفترة والمستخدم'});
  }

  function parseCsv(text) {
    text = text.replace(/^\ufeff/, '');
    const delimiters = [',',';','\t','؛'];
    let counts = [0,0,0,0], quote = false;
    for (let i=0; i<text.length; i++) {
      const ch=text[i];
      if (ch === '"') { if (quote && text[i+1] === '"') i++; else quote=!quote; }
      else if (!quote && (ch === '\n' || ch === '\r')) break;
      else if (!quote) { const n=delimiters.indexOf(ch); if(n>=0) counts[n]++; }
    }
    let index = counts.indexOf(Math.max(...counts));
    const sep = delimiters[index];
    const rows=[], row=[]; let field='', quoted=false, closed=false, atStart=true;
    for (let i=0; i<text.length; i++) {
      const c=text[i];
      if (quoted) {
        if (c==='"') { if(text[i+1]==='"') { field+='"'; i++; } else { quoted=false; closed=true; } }
        else field+=c;
      } else if (c==='"' && atStart) { quoted=true; atStart=false; }
      else if (c===sep) { row.push(field); field=''; atStart=true; closed=false; }
      else if (c==='\n' || c==='\r') {
        if(c==='\r' && text[i+1]==='\n') i++;
        row.push(field); rows.push(row.slice()); row.length=0; field=''; atStart=true; closed=false;
        if (rows.length > MAX_ROWS + 100) throw new Error(`تجاوز الملف الحد ${MAX_ROWS} صفًا`);
      } else {
        if (closed && c !== ' ' && c !== '\t') throw new Error('صياغة CSV غير صالحة بعد علامة الاقتباس');
        if (c==='"') throw new Error('علامة اقتباس غير متوقعة في CSV');
        if (!closed) field+=c;
        atStart=false;
      }
      if (row.length > MAX_COLS) throw new Error(`تجاوز عدد الأعمدة الحد ${MAX_COLS}`);
    }
    if (quoted) throw new Error('يوجد حقل CSV باقتباس غير مغلق');
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function pdfLines(items) {
    const lines=[];
    const usable=items.filter(item => typeof item.str === 'string' && item.str.trim() && item.transform)
      .map(item => ({text:item.str, dir:item.dir, x:item.transform[4], y:item.transform[5], width:Math.max(0,item.width||0)}))
      .sort((a,b) => b.y-a.y || a.x-b.x);
    for (const item of usable) {
      let line=lines[lines.length-1];
      if (line && Math.abs(line.y-item.y) > 2.5) line=null;
      if (!line) { line={y:item.y,items:[]}; lines.push(line); }
      line.items.push(item);
    }
    return lines.map(line => {
      const sorted=line.items.sort((a,b)=>a.x-b.x), chunks=[];
      for(const item of sorted) {
        const last=chunks[chunks.length-1], gap=last ? item.x-last.end : Infinity;
        if (last && gap <= 9) { last.parts.push({text:item.text,dir:item.dir,gap}); last.end=Math.max(last.end,item.x+item.width); }
        else chunks.push({parts:[{text:item.text,dir:item.dir,gap:0}], x:item.x, end:item.x+item.width});
      }
      for (const chunk of chunks) {
        const rtl=chunk.parts.filter(p=>p.dir==='rtl').length > chunk.parts.filter(p=>p.dir==='ltr').length;
        let text='';
        if (rtl) {
          for (let i=chunk.parts.length-1; i>=0; i--) text+=(i<chunk.parts.length-1 && chunk.parts[i+1].gap>1 ? ' ' : '')+chunk.parts[i].text;
        } else {
          for (let i=0; i<chunk.parts.length; i++) text+=(i>0 && chunk.parts[i].gap>1 ? ' ' : '')+chunk.parts[i].text;
        }
        chunk.text=text.normalize('NFKC');
      }
      return chunks;
    });
  }
  function pdfPageMatrix(items) {
    const lines=pdfLines(items), matrix=[]; let anchors=null;
    for(const line of lines) {
      const labels=line.map(c=>c.text.trim());
      if(findHeader(labels)) { anchors=line.map(c=>c.x); matrix.push(labels); continue; }
      if(!anchors) { matrix.push([]); continue; }
      const cells=anchors.map(()=> '');
      for(const chunk of line) {
        let i=0;
        while (i+1<anchors.length && chunk.x >= (anchors[i]+anchors[i+1])/2) i++;
        cells[i] += (cells[i] ? ' ' : '') + chunk.text.trim();
      }
      matrix.push(cells);
    }
    return matrix;
  }

  async function readPdf(bytes, result, users) {
    if (!scriptBase) throw new Error('تعذر تحديد مسار مكتبة PDF المحلية؛ حمّل shift-import.js من ملف');
    const pdfjs = await import(new URL('vendor/pdf.min.mjs', scriptBase).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', scriptBase).href;
    const task = pdfjs.getDocument({data:bytes, isEvalSupported:false, disableFontFace:true, useSystemFonts:true, enableXfa:false, useWorkerFetch:false});
    let pdf;
    try {
      pdf=await task.promise;
      if(pdf.numPages > MAX_PAGES) throw new Error(`يتجاوز PDF الحد ${MAX_PAGES} صفحة`);
      let textCount=0;
      for(let pageNum=1;pageNum<=pdf.numPages;pageNum++) {
        const page=await pdf.getPage(pageNum), content=await page.getTextContent();
        if(content.items.length > 100000) throw new Error('تحتوي صفحة PDF على عدد كبير جدًا من العناصر النصية');
        textCount+=content.items.filter(x => x.str && x.str.trim()).length;
        addMatrix(pdfPageMatrix(content.items), result, {page:pageNum}, users, false);
        page.cleanup();
      }
      if(!textCount) result.errors.push({message:'لم يُعثر على نص قابل للاستخراج؛ قد يكون PDF صورة، ولا تتوفر قراءة OCR'});
      else result.warnings.push({message:'استخراج أعمدة PDF يعتمد على مواضع النص وقد يختلف مع التخطيط؛ راجع كل خلية مقابل الأصل'});
    } finally { if(pdf) await pdf.destroy(); else await task.destroy(); }
  }

  function flagDuplicates(rows) {
    const keys=new Map();
    for(const row of rows) {
      if(!row.date || !row.shift || row.user_id === null) continue;
      const key=JSON.stringify([row.date,row.shift,String(row.user_id)]);
      if(!keys.has(key)) keys.set(key, []);
      keys.get(key).push(row);
    }
    for(const group of keys.values()) if(group.length>1) for(const row of group) {
      row.errors.push('توجد مناوبة مكررة للمستخدم والتاريخ والفترة داخل الملف'); row.status='needs_review';
    }
  }

  async function parse(file, users) {
    const result={rows:[],errors:[],warnings:[]};
    try {
      if(!file || typeof file.arrayBuffer !== 'function') throw new Error('اختر ملفًا صالحًا');
      if(!Array.isArray(users)) throw new Error('قائمة المستخدمين غير صالحة');
      if(file.size > MAX_BYTES) throw new Error('يتجاوز حجم الملف 15 ميغابايت');
      const name=str(file.name), ext=(name.match(/\.([^.]+)$/)||[])[1]?.toLowerCase();
      if(!['csv','xlsx','xls','pdf'].includes(ext)) throw new Error('نوع الملف غير مدعوم؛ استخدم CSV أو XLSX أو XLS أو PDF نصيًا');
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(bytes.length > MAX_BYTES) throw new Error('يتجاوز حجم الملف 15 ميغابايت');
      if(ext==='csv') {
        let text;
        try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
        catch (_) { throw new Error('يجب حفظ CSV بترميز UTF-8'); }
        addMatrix(parseCsv(text),result,{sheet:'CSV'},users,false);
      } else if(ext==='pdf') {
        await readPdf(bytes,result,users);
      } else {
        if(!root.XLSX || typeof root.XLSX.read !== 'function') throw new Error('مكتبة SheetJS المحلية غير محمّلة');
        const wb=root.XLSX.read(bytes,{type:'array',cellDates:false,cellNF:true,cellFormula:true,cellHTML:false});
        const date1904=!!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
        for(const name of wb.SheetNames) {
          const sheet=wb.Sheets[name], ref=sheet['!ref'];
          if(!ref) { result.warnings.push({source:{sheet:name},message:'ورقة فارغة'}); continue; }
          const range=root.XLSX.utils.decode_range(ref);
          if(range.e.r-range.s.r+1 > MAX_ROWS+100 || range.e.c-range.s.c+1 > MAX_COLS)
            throw new Error(`الورقة ${name} تتجاوز الحد المسموح للصفوف أو الأعمدة`);
          // Origin A1 preserves actual worksheet row numbers even when !ref begins later.
          range.s.r=0; range.s.c=0;
          if(range.e.r+1 > MAX_ROWS+100 || range.e.c+1 > MAX_COLS) throw new Error(`نطاق الورقة ${name} كبير جدًا`);
          const matrix=root.XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:true,range});
          // sheet_to_json may coerce date-formatted numbers to Date even when
          // cellDates is false. Retain the original serial for the 1900/1904 system.
          for (let r=0; r<matrix.length; r++) for (let c=0; c<matrix[r].length; c++) {
            if (matrix[r][c] instanceof Date) {
              const cell=sheet[root.XLSX.utils.encode_cell({r,c})];
              if (cell && typeof cell.v === 'number') matrix[r][c]=cell.v;
            }
          }
          addMatrix(matrix,result,{sheet:name},users,date1904,(row,map,rowIndex) => {
            for (const [field,col] of Object.entries(map)) {
              const address=root.XLSX.utils.encode_cell({r:rowIndex,c:col});
              const cell=sheet[address];
              if (cell && cell.f) row.errors.push(`الخلية ${address} تحتوي صيغة؛ راجع قيمتها المخزّنة قبل الاستيراد`);
              if (field === 'date' && typeof row.raw.date === 'number' &&
                  (!cell || !cell.z || !root.XLSX.SSF.is_date(cell.z))) {
                row.date=null;
                row.errors.push(`التاريخ الرقمي في ${address} غير منسق كتاريخ Excel؛ يرجى مراجعته`);
              }
            }
          });
        }
      }
      flagDuplicates(result.rows);
      if(!result.rows.length && !result.errors.length) result.errors.push({message:'لم يُعثر على صفوف مناورات قابلة للمعاينة؛ تحقق من العناوين وتنسيق الملف'});
    } catch(err) {
      // Partial results must never appear importable after a fatal read/limit error.
      result.rows=[];
      result.errors.push({message:`تعذر تحليل الملف: ${err && err.message ? err.message : 'خطأ غير معروف'}`});
    }
    return result;
  }
  root.WaslShiftImport=Object.freeze({parse});
  if(typeof module !== 'undefined' && module.exports) module.exports=root.WaslShiftImport;
})(typeof window !== 'undefined' ? window : globalThis);
