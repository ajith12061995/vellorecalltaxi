# test server for the emulator: serves the repo root and records /report?… calls in report.log
import http.server, os, sys
ROOT=sys.argv[1];LOG=sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s,*a,**k):super().__init__(*a,directory=ROOT,**k)
    def do_GET(s):
        if s.path.startswith('/report?'):
            open(LOG,'a').write(s.path[8:]+'\n');s.send_response(204);s.end_headers();return
        super().do_GET()
http.server.ThreadingHTTPServer(('0.0.0.0',8080),H).serve_forever()
