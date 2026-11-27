# test server for the emulator: serves the repo root and records /report?… calls in report.log
import http.server, os, sys, urllib.parse
ROOT=sys.argv[1];LOG=sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s,*a,**k):super().__init__(*a,directory=ROOT,**k)
    def do_GET(s):
        if s.path.startswith('/report?'):
            open(LOG,'a').write(urllib.parse.unquote(s.path[8:])+'\n');s.send_response(204);s.end_headers();return
        super().do_GET()
    # 1.0.17 NativeLive test: stand-ins for securetoken.googleapis.com and the Firestore REST commit
    def do_POST(s):
        n=int(s.headers.get('Content-Length') or 0);body=s.rfile.read(n).decode('utf-8','replace')
        if s.path.startswith('/fake/v1/token'):
            open(LOG,'a').write('token='+body.replace('\n',' ')+'\n')
            out=b'{"id_token":"idt-test","expires_in":"3600","refresh_token":"rt-next"}'
        elif s.path.startswith('/fake/v1/projects/') and s.path.endswith('documents:commit'):
            open(LOG,'a').write('commit='+(s.headers.get('Authorization') or '')+' '+body.replace('\n',' ')+'\n')
            out=b'{"writeResults":[{}]}'
        else:
            s.send_response(404);s.end_headers();return
        s.send_response(200);s.send_header('Content-Type','application/json');s.send_header('Content-Length',str(len(out)));s.end_headers();s.wfile.write(out)
http.server.ThreadingHTTPServer(('0.0.0.0',8080),H).serve_forever()
