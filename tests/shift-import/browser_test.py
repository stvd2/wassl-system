#!/usr/bin/env python3
"""Local Chromium integration test; requires Python playwright and reportlab.
Run: python3 tests/shift-import/browser_test.py
"""
import base64
import io
import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright
from reportlab.pdfgen.canvas import Canvas

PROJECT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
PUBLIC = os.path.join(PROJECT, 'public')

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/fixture':
            body = b'<!doctype html><meta charset="utf-8"><script src="/shift-import/vendor/xlsx.full.min.js"></script><script src="/shift-import/shift-import.js"></script>'
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        else:
            super().do_GET()
    def log_message(self, *args):
        pass

def pdf_bytes(with_text):
    buf=io.BytesIO()
    c=Canvas(buf, pagesize=(600,800))
    if with_text:
        for p in range(2):
            for x, value in [(40,'Date'), (160,'Shift'), (270,'Name'), (420,'Notes')]:
                c.drawString(x,760,value)
            for x, value in [(40, f'2026-11-{25+p}'), (160,'Morning' if p == 0 else 'Night'), (270,'Sara Hassan'), (420,'ICU')]:
                c.drawString(x,730,value)
            c.showPage()
    else:
        c.rect(50,50,100,100)
    c.save()
    return buf.getvalue()

def main():
    httpd=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=PUBLIC))
    t=threading.Thread(target=httpd.serve_forever,daemon=True); t.start()
    origin=f'http://127.0.0.1:{httpd.server_port}'
    external=[]
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            page=browser.new_page()
            def route_request(route):
                url=route.request.url
                if url.startswith(origin + '/'):
                    route.continue_()
                else:
                    external.append(url); route.abort()
            page.route('**/*',route_request)
            page.goto(origin+'/fixture', wait_until='load')
            check = '''async ({encoded, filename}) => {
              const bytes=Uint8Array.from(atob(encoded), c=>c.charCodeAt(0));
              const file=new File([bytes],filename);
              return await window.WaslShiftImport.parse(file,[{id:'u2',username:'102',full_name:'Sara Hassan',role:'coordinator',active:true},{id:'u3',username:'103',full_name:'سارة حسن',role:'doctor',active:true}]);
            }'''
            pdf=page.evaluate(check, {'filename':'schedule.pdf','encoded':base64.b64encode(pdf_bytes(True)).decode()})
            assert not pdf['errors'], json.dumps(pdf,ensure_ascii=False)
            assert len(pdf['rows']) == 2, json.dumps(pdf,ensure_ascii=False)
            assert [r['date'] for r in pdf['rows']] == ['2026-11-25','2026-11-26'], pdf
            assert [r['shift'] for r in pdf['rows']] == ['صباحي','ليلي'], pdf
            assert all(r['status'] == 'ready' and r['user_id']=='u2' for r in pdf['rows']), pdf
            arabic_page=browser.new_page()
            arabic_page.set_content('''<meta charset="utf-8"><style>table { border-collapse: collapse; width: 90%; } th,td { width: 25%; text-align: right; }</style><table dir="rtl"><tr><th>التاريخ</th><th>الفترة</th><th>اسم المستخدم</th><th>ملاحظات</th></tr><tr><td>٢٥ ديسمبر ٢٠٢٦</td><td>صباحي</td><td>سارة حسن</td><td>طوارئ</td></tr></table>''')
            arabic_bytes=arabic_page.pdf(); arabic_page.close()
            arabic=page.evaluate(check, {'filename':'arabic.pdf','encoded':base64.b64encode(arabic_bytes).decode()})
            assert len(arabic['rows'])==1, json.dumps(arabic,ensure_ascii=False)
            assert arabic['rows'][0]['status']=='ready' and arabic['rows'][0]['date']=='2026-12-25' and arabic['rows'][0]['user_id']=='u3', json.dumps(arabic,ensure_ascii=False)
            image=page.evaluate(check, {'filename':'scan.pdf','encoded':base64.b64encode(pdf_bytes(False)).decode()})
            assert not image['rows'] and any('OCR' in e['message'] for e in image['errors']), image
            csv=page.evaluate(check, {'filename':'schedule.csv','encoded':base64.b64encode(b'Date,Shift,Name\n2026-11-25,Morning,Sara Hassan').decode()})
            assert csv['rows'][0]['status']=='ready', csv
            assert not external, external
            browser.close()
        print('Browser integration passed: English and Arabic text PDFs, image-only PDF, CSV, no external requests.')
    finally:
        httpd.shutdown(); httpd.server_close()

if __name__ == '__main__':
    main()
