# test server for the emulator: serves the repo root and records /report?… calls in report.log
import http.server, os, sys, urllib.parse
ROOT=sys.argv[1];LOG=sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s,*a,**k):super().__init__(*a,directory=ROOT,**k)
    def do_GET(s):
        if s.path.startswith('/report?'):
            open(LOG,'a').write(urllib.parse.unquote(s.path[8:])+'\n');s.send_response(204);s.end_headers();return
        # 1.0.20 RideFallback: the phone reads the pushed ride from Firestore (REST) before it rings by itself
        if s.path.startswith('/fake/v1/projects/') and '/documents/bookings/' in s.path:
            bid=urllib.parse.unquote(s.path.rsplit('/',1)[1]);open(LOG,'a').write('read='+(s.headers.get('Authorization') or '')+' '+bid+'\n')
            import time;st='assigned' if 'gone' in bid else 'searching';lat=13.1 if 'far' in bid else 12.9800
            doc={'name':'x/bookings/'+bid,'fields':{'status':{'stringValue':st},'veh':{'stringValue':'mini'},'when':{'integerValue':str(int(time.time()*1000))},
                 'from':{'mapValue':{'fields':{'lat':{'doubleValue':lat},'lon':{'doubleValue':79.1650}}}},'tip':{'integerValue':'0'}}}
            import json;out=json.dumps(doc).encode()
            s.send_response(200);s.send_header('Content-Type','application/json');s.send_header('Content-Length',str(len(out)));s.end_headers();s.wfile.write(out);return
        super().do_GET()
    # 1.0.17 NativeLive test: stand-ins for securetoken.googleapis.com and the Firestore REST commit
    def do_POST(s):
        n=int(s.headers.get('Content-Length') or 0);body=s.rfile.read(n).decode('utf-8','replace')
        if s.path.startswith('/fake/v1/token'):
            open(LOG,'a').write('token='+body.replace('\n',' ')+'\n')
            out=b'{"id_token":"idt-test.eyJ1c2VyX2lkIjoidWlkLXRlc3QifQ.sig","expires_in":"3600","refresh_token":"rt-next"}'
        elif s.path.startswith('/fake/v1/projects/') and s.path.endswith('documents:commit'):
            open(LOG,'a').write('commit='+(s.headers.get('Authorization') or '')+' '+body.replace('\n',' ')+'\n')
            out=b'{"writeResults":[{}]}'
        elif s.path.startswith('/fake/v1/projects/') and s.path.endswith('documents:runQuery'):
            open(LOG,'a').write('query='+body.replace('\n',' ')+'\n')
            out=b'[{"readTime":"2026-11-27T00:00:00Z"}]'
            # 1.0.22: the phone's own lookup for waiting rides (status + veh): one ride while tests/android/poll.flag exists
            if '"searching"' in body and os.path.exists(os.path.join(ROOT,'tests/android/poll.flag')):
                import json,time
                doc={'document':{'name':'projects/p/databases/(default)/documents/bookings/poll-1','fields':{'status':{'stringValue':'searching'},'veh':{'stringValue':'mini'},
                  'fare':{'integerValue':'90'},'tip':{'integerValue':'0'},'when':{'integerValue':str(int(time.time()*1000))},
                  'from':{'mapValue':{'fields':{'en':{'stringValue':'Katpadi Junction'},'lat':{'doubleValue':12.98},'lon':{'doubleValue':79.165}}}},
                  'to':{'mapValue':{'fields':{'en':{'stringValue':'CMC Hospital'}}}}}}}
                out=json.dumps([doc]).encode()
        else:
            s.send_response(404);s.end_headers();return
        s.send_response(200);s.send_header('Content-Type','application/json');s.send_header('Content-Length',str(len(out)));s.end_headers();s.wfile.write(out)
http.server.ThreadingHTTPServer(('0.0.0.0',8080),H).serve_forever()
