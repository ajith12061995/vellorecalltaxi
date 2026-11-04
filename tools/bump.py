#!/usr/bin/env python3
"""Release helper: set one new version everywhere so every phone reloads the new app.
Usage:  python3 tools/bump.py 2026-11-03-36
Updates APPV in the four pages, the ?v= tag on every core/*.js include, and version.json."""
import re,sys,os,json
v=sys.argv[1];root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for p in ['index.html','driver/index.html','driver/join/index.html','office/index.html']:
    f=os.path.join(root,p);s=open(f).read()
    s=re.sub(r"(APPV=(?:window\.VCT_V=)?)'[^']+'",lambda m:f"{m.group(1)}'{v}'",s)
    s=re.sub(r'(core/\w+\.js)\?v=[^"]+',rf'\1?v={v}',s)
    open(f,'w').write(s)
json.dump({'v':v},open(os.path.join(root,'version.json'),'w'))
print('version',v)
# keep the TEST copy (velloretaxi.app/staging/) identical to the live code
import subprocess;subprocess.run([sys.executable,os.path.join(root,'tools','staging.py')],check=True)
