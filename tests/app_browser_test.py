#!/usr/bin/env python3
"""Local browser smoke tests. No production endpoints or patient data are used."""
import json
import threading
from copy import deepcopy
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
lock = threading.RLock()
now = '2026-11-22T00:00:00.000Z'
users = [
    {'id': 'admin-id', 'username': 'admin', 'full_name': 'مدير اختبار', 'role': 'admin', 'active': True, 'created_at': now, 'mobile': '0500000001'},
    {'id': 'doctor-id', 'username': 'doc', 'full_name': 'طبيب اختبار', 'role': 'doctor', 'department': 'الباطنة', 'active': True, 'created_at': now, 'mobile': '0500000002'},
    {'id': 'coordinator-id', 'username': 'coord', 'full_name': 'منسق اختبار', 'role': 'coordinator', 'active': True, 'created_at': now, 'mobile': '0500000003'},
    {'id': 'beds-id', 'username': 'beds', 'full_name': 'إدارة أسرّة اختبار', 'role': 'beds', 'active': True, 'created_at': now, 'mobile': '0500000004'},
]
refs = [{'id': f'ref-{i}', 'ref_no': f'R-{i}', 'patient_name': f'مريض تجريبي {i}', 'mrn': str(i), 'priority': 'تنويم عادي', 'specialty': 'الباطنة', 'target_specialty': 'الباطنة', 'status': 'awaiting_doctor', 'created_at': now, 'updated_at': now, 'diagnosis': 'اختبار', 'timeline': [], 'attachment_ids': []} for i in range(25)]
defaults = [('جميع المنسقين','coordinator'),('جميع الأطباء','doctor'),('إدارة الأسرة','beds'),('المديرون','admin'),('الجميع','all')]
chats = [{'id': 'chat-1', 'type': 'direct', 'members': ['admin-id', 'doctor-id'], 'created_at': now, 'reads': {}, 'messages': []}] + [{'id': f'group-{c}', 'type': 'group', 'name': n, 'category': c, 'members': 'auto', 'created_at': now, 'reads': {}, 'messages': []} for n, c in defaults]
state = {'meta': {'version':'v6', 'sync_revision':1, 'seed_done':True, 'seq':25, 'auditSeq':0, 'notifSeq':0, 'local_updated_at':now}, 'users':users, 'referrals':refs, 'beds':[], 'audit':[], 'notifications':[], 'attachments':{}, 'outgoing_referrals':[], 'chats':chats, 'shifts':[]}
attachments = {}
fail_put = False
fail_attachment = False

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
    def reply(self, status, body, kind='application/json; charset=utf-8'):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type', kind); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        path = urlparse(self.path)
        if path.path == '/api/config':
            self.reply(200, {'supabaseUrl': '', 'supabaseClientKey': ''})
        elif path.path == '/api/login':
            self.reply(200, {'authenticated': True, 'user': deepcopy(users[0])})
        elif path.path == '/api/state':
            with lock: self.reply(200, deepcopy(state))
        elif path.path == '/api/attachment':
            key = parse_qs(path.query).get('id', [''])[0]
            if key not in attachments: self.reply(404, {'error':'not found'}); return
            body, kind = attachments[key]; self.reply(200, body, kind)
        else: super().do_GET()
    def do_PUT(self):
        path = urlparse(self.path)
        body = self.rfile.read(int(self.headers.get('content-length', '0')))
        if path.path == '/api/attachment':
            key = parse_qs(path.query).get('id', [''])[0]
            if fail_attachment:
                self.reply(503, {'error':'temporary failure'}); return
            attachments[key] = (body, self.headers.get('content-type', 'application/octet-stream')); self.reply(200, {'ok':True}); return
        if path.path != '/api/state': self.reply(404, {'error':'not found'}); return
        payload = json.loads(body)
        with lock:
            if fail_put:
                self.reply(503, {'error':'temporary failure'}); return
            if payload['meta']['sync_revision'] != state['meta']['sync_revision']:
                self.reply(409, {'conflict':True}); return
            payload['meta']['sync_revision'] += 1
            state.clear(); state.update(deepcopy(payload))
            self.reply(200, {'ok':True, 'revision':payload['meta']['sync_revision'], 'data':payload})

    def do_POST(self):
        path = urlparse(self.path)
        body = self.rfile.read(int(self.headers.get('content-length', '0')))
        if path.path != '/api/state': self.reply(404, {'error':'not found'}); return
        payload = json.loads(body or b'{}')
        if payload.get('action') != 'clear_chat': self.reply(400, {'error':'invalid action'}); return
        with lock:
            chat = next((c for c in state['chats'] if c['id'] == payload.get('chat_id')), None)
            if not chat: self.reply(404, {'error':'not found'}); return
            if payload.get('expected_revision') != state['meta']['sync_revision']:
                self.reply(409, {'error':'conflict'}); return
            ids = {str(a) for m in chat.get('messages', []) for a in m.get('atts', [])}
            for aid, meta in list(state.get('attachments', {}).items()):
                if str(meta.get('referral_id', '')).endswith(chat['id']): ids.add(str(aid))
                if str(aid) in ids: state['attachments'].pop(aid, None); attachments.pop(str(aid), None)
            count = len(chat.get('messages', [])); chat['messages'] = []; chat['reads'] = {}
            state['meta']['sync_revision'] += 1
            self.reply(200, {'ok':True, 'data':deepcopy(state), 'revision':state['meta']['sync_revision'], 'deletedAttachments':len(ids), 'messagesCleared':count})

def main():
    global fail_put, fail_attachment
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT / 'public')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width':390, 'height':844})
            context.route('https://**/*', lambda r: r.abort())
            page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(url, wait_until='domcontentloaded')
            page.wait_for_selector('#app:not(.hidden)', timeout=15000)
            page.wait_for_function('LOCAL_CHANGE_SERIAL === CONFIRMED_CHANGE_SERIAL && !_syncBlocked', timeout=15000)
            page.reload(wait_until='domcontentloaded')
            page.wait_for_selector('#app:not(.hidden)', timeout=15000)
            page.wait_for_function('LOCAL_CHANGE_SERIAL === CONFIRMED_CHANGE_SERIAL && !_syncBlocked', timeout=15000)
            page.evaluate("showPage('dashboard')")
            assert page.locator('#modalRoot .section-modal').count() == 1, 'dashboard opens in section modal'
            page.evaluate("showPage('audit')")
            assert page.locator('#modalRoot .section-modal').count() == 1, 'audit opens in section modal'
            page.evaluate("showPage('outgoing')")
            assert page.locator('#modalRoot .section-modal').count() == 1, 'referral list opens in section modal'
            assert page.locator('#modalRoot button').filter(has_text='إحالة جديدة').count() == 0, 'create referral stays outside section modal'
            assert page.locator('#listWrap tbody tr').count() == 10, 'pagination first page'
            assert page.locator('nav[aria-label="صفحات الإحالات"]').count() == 1
            page.locator('select[aria-label="حجم صفحة الإحالات"]').select_option('25')
            assert page.locator('#listWrap tbody tr').count() == 25, 'pagination page size 25'
            assert 'إجمالي 25 سجل' in page.locator('nav[aria-label="صفحات الإحالات"]').inner_text()
            page.locator('select[aria-label="حجم صفحة الإحالات"]').select_option('10')
            page.locator('nav[aria-label="صفحات الإحالات"] button').filter(has_text='2').click()
            assert page.locator('#listWrap tbody tr').count() == 10, 'pagination second page'
            assert page.locator('#listWrap tbody tr').first.locator('td').count() == 8, 'row markup'
            page.locator('#listWrap tbody tr').first.locator('td').nth(1).click()
            assert page.locator('#modalRoot .modal').count() == 1, 'row should open details'
            page.evaluate('closeModal()')
            page.wait_for_function('LOCAL_CHANGE_SERIAL === CONFIRMED_CHANGE_SERIAL && !_syncBlocked', timeout=15000)
            page.evaluate("showPage('create')")
            assert page.locator('#modalRoot .modal').count() == 1, 'create referral opens in modal'
            assert page.locator('#createReferralTitle').inner_text() == '📋 إحالة جديدة'
            assert page.locator('#modalRoot button[aria-label="إغلاق نموذج الإحالة"]').count() == 1, 'modal close button'
            assert page.locator('#modalRoot .modal').evaluate('(x) => x.scrollHeight > x.clientHeight'), 'modal scrolls internally'
            page.locator('#createForm [name=patient_name]').fill('مسودة لا يجب فقدها')
            with lock:
                state['meta']['sync_revision'] += 1; state['meta']['local_updated_at'] = '2027-01-01T00:00:00.000Z'
            page.evaluate('refreshFromRealtime()')
            assert page.locator('#createForm [name=patient_name]').input_value() == 'مسودة لا يجب فقدها'
            page.evaluate('closeModal()')
            assert page.locator('#modalRoot .section-modal').count() == 1, 'create modal closes back to section'
            for role, page_name in [('coordinator', 'outgoing'), ('admin', 'outgoing'), ('doctor', 'doctor_inbox'), ('beds', 'bed_requests')]:
                page.evaluate('''([role, target]) => {
                  CURRENT_USER = structuredClone(DATA.users.find(u => u.role === role));
                  PAGE = target; buildNav(); showPage(target);
                }''', [role, page_name])
                assert page.locator('button.nav').filter(has_text='إحالة جديدة').count() == 0, f'create removed from sidebar for {role}'
                assert page.locator('#topCreateReferral').is_visible(), f'independent create button for {role}'
                page.evaluate('showPage("create")')
                assert page.locator('#modalRoot .modal').count() == 1, f'create modal for {role}'
                page.evaluate('closeModal()')
            # Phase 1 outgoing referral flow: doctor -> coordinator issue -> notification/follow-up.
            page.evaluate("CURRENT_USER=structuredClone(DATA.users.find(u=>u.role==='doctor')); PAGE='outgoing_referrals'; buildNav(); showPage('outgoing_referrals')")
            page.locator('button').filter(has_text='إحالة صادرة جديدة').click()
            page.locator('#outgoingForm [name=patient_name]').fill('مريض صادر محلي')
            page.locator('#outgoingForm [name=mrn]').fill('OUT-MRN-1')
            page.locator('#outgoingForm [name=age]').fill('42')
            page.locator('#outgoingForm [name=specialty]').select_option(label='أمراض القلب / Cardiology')
            page.locator('#outgoingForm [name=case_type]').select_option('إنقاذ حياة')
            assert page.locator('#ministerialCode').is_visible(), 'life code appears immediately'
            page.locator('#outgoingForm [name=ministerial_code]').fill('LIFE-001')
            page.locator('#outgoingForm [name=clinical_request]').fill('تقييم عاجل وتحويل فوري')
            page.locator('#outgoingForm button[type=submit]').click()
            page.wait_for_function("DATA.outgoing_referrals.length === 1 && DATA.outgoing_referrals[0].case_type === 'إنقاذ حياة'")
            assert page.evaluate("DATA.outgoing_referrals[0].priority") == 'قصوى'
            outgoing_id = page.evaluate('DATA.outgoing_referrals[0].id')
            page.evaluate("CURRENT_USER=structuredClone(DATA.users.find(u=>u.role==='coordinator')); PAGE='outgoing_referrals'; buildNav(); showPage('outgoing_referrals')")
            page.wait_for_selector('button:has-text("إصدار")', timeout=10000)
            page.locator('button').filter(has_text='إصدار').click()
            page.locator('[name=ministerial_ref_no]').fill('MIN-2027-001')
            page.locator('[name=acceptance_letter]').set_input_files({'name':'acceptance.pdf','mimeType':'application/pdf','buffer':b'acceptance'})
            page.locator('#modalRoot button[type=submit]').click()
            page.wait_for_function("DATA.outgoing_referrals[0].status === 'issued' && DATA.outgoing_referrals[0].ministerial_ref_no === 'MIN-2027-001' && !!DATA.outgoing_referrals[0].acceptance_letter_attachment_id", timeout=15000)
            assert page.evaluate("DATA.outgoing_referrals[0].acceptance_letter_attachment_id")
            assert page.evaluate("DATA.outgoing_referrals[0].timeline.some(x=>x.action.includes('إصدار رسمي'))")
            page.evaluate("CURRENT_USER=structuredClone(DATA.users.find(u=>u.role==='doctor')); PAGE='outgoing_referrals'; buildNav(); showPage('outgoing_referrals')")
            assert page.locator('button').filter(has_text='تذكير').count() == 1, 'doctor follow-up button'
            page.locator('button').filter(has_text='تذكير').click()
            page.locator('[name=message]').fill('يرجى تحديث حالة القبول')
            page.locator('#modalRoot button[type=submit]').click()
            page.wait_for_function("DATA.outgoing_referrals[0].status === 'follow_up'")
            page.evaluate("CURRENT_USER=structuredClone(DATA.users.find(u=>u.role==='admin')); PAGE='dashboard'; buildNav(); showPage('dashboard')")
            assert 'المدير الطبي — الصادر' in page.locator('#content').inner_text(), 'medical dashboard outgoing panel'
            page.evaluate("""() => {
              for (let i = 2; i <= 25; i++) DATA.outgoing_referrals.push({id:'OUT-'+i, patient_name:'مريض '+i, mrn:'MRN-'+i, specialty:i%2?'الباطنة / Internal Medicine':'أمراض القلب / Cardiology', case_type:i%3?'عادية':'طارئة', status:i%4?'issued':'follow_up', ministerial_ref_no:'MIN-'+i, created_by:'doctor-id', created_at:'2027-01-01T00:00:00Z', updated_at:'2027-01-01T00:00:00Z', timeline:[], attachment_ids:[]});
              PAGE='outgoing_referrals'; buildNav(); showPage('outgoing_referrals');
            }""")
            assert page.locator('nav[aria-label="صفحات الصادر"]').count() == 1, 'outgoing pagination'
            assert page.locator('nav[aria-label="صفحات الصادر"] span').filter(has_text='إجمالي 25 سجل').count() == 1, 'outgoing total count'
            page.locator('.outgoing-filters select').nth(1).select_option('طارئة')
            assert page.locator('table.t tbody tr').count() > 0, 'outgoing type filter'
            page.locator('.outgoing-filters select').nth(1).select_option('')
            page.locator('.outgoing-filters input').fill('MRN-25')
            assert page.locator('table.t tbody tr').count() == 1, 'outgoing search filter'
            page.evaluate('''() => {
              CURRENT_USER = structuredClone(DATA.users.find(u => u.role === 'admin'));
              PAGE = 'outgoing'; buildNav(); showPage('outgoing');
            }''')
            page.evaluate("CURRENT_CHAT='chat-1'; CHAT_TAB='direct'; showPage('chat'); openChat('chat-1')")
            assert page.locator('#modalRoot .section-modal').count() == 0, 'chat remains outside section modal'
            page.wait_for_function('LOCAL_CHANGE_SERIAL === CONFIRMED_CHANGE_SERIAL && !_syncBlocked', timeout=15000)
            page.locator('#chatText').fill('مسودة رسالة محفوظة')
            page.locator('#chatImgInput').set_input_files({'name':'sample.png','mimeType':'image/png','buffer':b'fake-image'})
            with lock:
                next(c for c in state['chats'] if c['id']=='chat-1')['messages'].append({'id':'incoming-1','from':'doctor-id','from_name':'طبيب اختبار','text':'رسالة واردة تجريبية','atts':[],'ts':'2027-01-01T00:00:00.000Z'})
                state['meta']['sync_revision'] += 1; state['meta']['local_updated_at'] = '2027-01-01T00:00:01.000Z'
            page.evaluate('refreshFromRealtime()')
            assert page.locator('#chatText').input_value() == 'مسودة رسالة محفوظة'
            assert page.locator('#chatImgInput').evaluate('(x) => x.files.length') == 1, 'selected attachment preserved on sync'
            fail_attachment = True
            page.locator('.chat-input button[type=submit]').click()
            page.wait_for_function("document.querySelector('#toast').textContent.includes('فشل رفع')", timeout=10000)
            assert page.locator('#chatText').input_value() == 'مسودة رسالة محفوظة', 'chat draft retained after failed attachment'
            assert page.locator('#chatImgInput').evaluate('(x) => x.files.length') == 1, 'chat file retained after failed upload'
            fail_attachment = False
            assert 'رسالة واردة تجريبية' in page.locator('#chatMsgs').inner_text()
            assert page.locator('#chatMain').is_visible(), 'mobile chat stays visible'
            page.once('dialog', lambda dialog: dialog.accept())
            page.locator('[data-clear-chat="chat-1"]').click()
            page.wait_for_function("DATA.chats.find(c=>c.id==='chat-1').messages.length === 0")
            assert page.locator('[data-clear-chat="chat-1"]').count() == 1, 'cleared chat remains available'
            assert 'لا رسائل' in page.locator('#chatMsgs').inner_text(), 'chat was cleared'
            merged = page.evaluate('''() => {
              const b=initData(); b.chats=[{id:'x',type:'direct',messages:[],reads:{}}];
              const r=structuredClone(b), l=structuredClone(b);
              r.chats[0].messages.push({id:'r',ts:'2026-01-01',text:'R'});
              l.chats[0].messages.push({id:'l',ts:'2026-01-02',text:'L'});
              return mergeStateSnapshots(r,l,b).chats[0].messages.map(x=>x.id);
            }''')
            assert merged == ['r','l'], f'concurrent chat messages: {merged}'
            conflict = page.evaluate('''() => {
              const b=initData(); b.referrals=[{id:'x',status:'a'}];
              const r=structuredClone(b), l=structuredClone(b); r.referrals[0].status='b'; l.referrals[0].status='c';
              try { mergeStateSnapshots(r,l,b); return false } catch(e) { return true }
            }''')
            assert conflict, 'conflicting medical decisions must not be silently overwritten'
            duplicate = page.evaluate('''() => {
              const b=initData(); b.users=[{id:'d',role:'doctor',active:true}];
              const r=structuredClone(b), l=structuredClone(b);
              r.shifts=[{id:'r',user_id:'d',role:'doctor',date:'2027-01-01',shift:'صباحي'}];
              l.shifts=[{id:'l',user_id:'d',role:'doctor',date:'2027-01-01',shift:'صباحي'}];
              try { mergeStateSnapshots(r,l,b); return false } catch(e) { return true }
            }''')
            assert duplicate, 'concurrent duplicate shifts must be blocked'
            duplicate_referral = page.evaluate('''() => {
              const b=initData(), r=structuredClone(b), l=structuredClone(b);
              r.referrals=[{id:'r',ref_no:'R-SAME',status:'awaiting_doctor'}];
              l.referrals=[{id:'l',ref_no:'R-SAME',status:'awaiting_doctor'}];
              try { mergeStateSnapshots(r,l,b); return false } catch(e) { return true }
            }''')
            assert duplicate_referral, 'concurrent duplicate referral numbers must be blocked'
            page.evaluate("showPage('outgoing');openEditReferral('ref-0')")
            page.locator('#modalRoot [name=patient_name]').fill('اسم في مسودة قديمة')
            page.evaluate("DATA.referrals.find(r=>r.id==='ref-0').diagnosis='تشخيص أحدث من جهاز آخر'")
            page.locator('#modalRoot button[type=submit]').click()
            assert page.locator('#modalRoot [name=patient_name]').input_value() == 'اسم في مسودة قديمة'
            assert page.evaluate("DATA.referrals.find(r=>r.id==='ref-0').diagnosis") == 'تشخيص أحدث من جهاز آخر'
            page.evaluate("DATA.referrals.find(r=>r.id==='ref-0').diagnosis='اختبار';closeModal()")
            page.evaluate("showPage('notifications')")
            assert page.locator('#modalRoot .section-modal').count() == 1, 'notifications opens in section modal'
            page.evaluate("showPage('shifts')")
            assert page.locator('#modalRoot .section-modal').count() == 1, 'shifts opens in section modal'
            page.evaluate("showImportShifts()")
            assert page.locator('#modalRoot .section-modal').count() == 0, 'shift import opens as child modal'
            csv = 'التاريخ,الفترة,اسم الدخول,ملاحظات\n2027-02-15,صباحي,doc,اختبار\n'.encode()
            page.locator('#shiftImportFile').set_input_files({'name':'shifts.csv','mimeType':'text/csv','buffer':csv})
            page.wait_for_selector('[data-shift-row="0"]', timeout=20000)
            assert page.locator('[data-shift-row="0"] [data-field=user]').input_value() == 'doctor-id'
            page.locator('[data-shift-row="0"] [data-field=reviewed]').check()
            page.locator('#shiftImportAttach').check()
            page.on('dialog', lambda dialog: dialog.accept())
            page.locator('#shiftImportConfirm').click()
            page.wait_for_function("DATA.shifts.some(s => s.date === '2027-02-15' && s.user_id === 'doctor-id')", timeout=15000)
            page.wait_for_function('LOCAL_CHANGE_SERIAL === CONFIRMED_CHANGE_SERIAL && !_syncBlocked', timeout=15000)
            item = page.evaluate("DATA.shifts.find(s => s.date === '2027-02-15')")
            assert item['attachment_id'] in attachments, 'original file should be stored'
            page.evaluate("showPage('create')")
            for field, value in {'patient_name':'مسودة محفوظة','mrn':'999999','ref_no':'TEST-FAIL','to_hospital':'مستشفى وهمي','diagnosis':'فحص محلي'}.items():
                page.locator(f'#createForm [name={field}]').fill(value)
            page.locator('#createForm [name=target_specialty]').select_option('الباطنة')
            page.locator('#createForm [name=priority]').select_option('تنويم عادي')
            page.locator('#createForm [name=files]').set_input_files({'name':'fake.pdf','mimeType':'application/pdf','buffer':b'fake-pdf'})
            before = page.evaluate('DATA.referrals.length')
            fail_attachment = True
            page.locator('#submitBtn').click()
            page.wait_for_function("document.querySelector('#toast').textContent.includes('فشل رفع')", timeout=10000)
            assert page.locator('#createForm [name=patient_name]').input_value() == 'مسودة محفوظة'
            assert page.locator('#createForm [name=files]').evaluate('(x) => x.files.length') == 1
            assert page.evaluate('DATA.referrals.length') == before, 'failed upload must not save incomplete referral'
            fail_attachment = False
            # Keep a failed server write across page refresh, then safely retry it.
            with lock: fail_put = True
            page.evaluate("DATA.referrals[0].diagnosis='تعديل لم يؤكده الخادم'; saveData()")
            page.wait_for_function("!!sessionStorage.getItem(PENDING_SYNC_KEY) && LOCAL_CHANGE_SERIAL !== CONFIRMED_CHANGE_SERIAL")
            page.wait_for_timeout(700)
            page.reload(wait_until='domcontentloaded')
            page.wait_for_selector('#app:not(.hidden)', timeout=15000)
            assert page.evaluate("DATA.referrals[0].diagnosis") == 'تعديل لم يؤكده الخادم', 'pending change survives reload'
            with lock:
                assert state['referrals'][0]['diagnosis'] != 'تعديل لم يؤكده الخادم'
                fail_put = False
            page.evaluate('syncNow()')
            page.wait_for_function('LOCAL_CHANGE_SERIAL === CONFIRMED_CHANGE_SERIAL && !_syncBlocked', timeout=15000)
            with lock: assert state['referrals'][0]['diagnosis'] == 'تعديل لم يؤكده الخادم'
            assert page.evaluate("sessionStorage.getItem(PENDING_SYNC_KEY)") is None, 'journal cleared after confirmed save'
            # A concurrent edit of the same referral is blocked on recovery, not silently merged.
            with lock: fail_put = True
            page.evaluate("DATA.referrals[0].status='local-decision'; saveData()")
            page.wait_for_timeout(700)
            with lock:
                state['referrals'][0]['status'] = 'server-decision'
                state['meta']['sync_revision'] += 1
                fail_put = False
            page.reload(wait_until='domcontentloaded')
            page.wait_for_selector('#app:not(.hidden)', timeout=15000)
            assert page.evaluate('_syncBlocked'), 'conflict must stop writes'
            assert page.evaluate('DATA.referrals[0].status') == 'local-decision'
            with lock: assert state['referrals'][0]['status'] == 'server-decision'
            assert page.evaluate("!!sessionStorage.getItem(PENDING_SYNC_KEY)"), 'conflict journal retained'
            assert not errors, f'page errors: {errors}'
            print('PASS: session refresh, pagination, clickable row, draft-preserving sync, chat merge/conflict, mobile layout, CSV preview, attachment import, pending reload and conflict blocking')
            context.close(); browser.close()
    finally:
        server.shutdown(); server.server_close()

if __name__ == '__main__': main()
