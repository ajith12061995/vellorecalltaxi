#!/usr/bin/env python3
"""Build the mock-Firebase test pages from the real app pages.
Output goes to tests/e2e/out/ (git-ignored). Serve the REPO ROOT on :8765, then run any run*.py.
  python3 tests/e2e/build.py && (cd <repo> && python3 -m http.server 8765) & python3 tests/e2e/runav.py
The apps are unchanged except: Firebase is swapped for the in-memory mock (mockfb.js),
the Google Maps / Leaflet CDN are swapped for the local Leaflet copy, and auto-update is removed."""
import os,re
E=os.path.dirname(os.path.abspath(__file__));R=os.path.dirname(os.path.dirname(E));O=os.path.join(E,'out')
os.makedirs(O,exist_ok=True);os.makedirs(os.path.join(E,'shots'),exist_ok=True)
def build(src,dst):
    r=open(os.path.join(R,src)).read();k=r.index('</head>');head,rest=r[:k],r[k:]
    out=[]
    for l in head.split('\n'):
        if 'maps-config.js' in l or 'GMAPS_KEY' in l or 'vct-cloud.js' in l or 'unpkg.com/leaflet' in l: continue
        if 'window.CLOUD_READY=new Promise' in l: l='<link rel="stylesheet" href="../lf/leaflet.css"><script src="../lf/leaflet.js"></script><script>window.CLOUD_READY=Promise.resolve(parent.makeApi())</script>'
        out.append(l)
    s='\n'.join(out)+rest
    if '<script>/* auto-update' in s:
        i=s.index('<script>/* auto-update');j=s.index('</script>',i)+9;s=s[:i]+s[j:]
    s=re.sub(r'src="(\.\./|\./)*core/','src="../../../core/',s)
    if 'CLOUD_READY=Promise.resolve(parent.makeApi())' not in s: print('WARN no cloud hook',src)
    open(os.path.join(O,dst),'w').write(s)
build('index.html','c2.html');build('driver/index.html','d2.html');build('office/index.html','o2.html');build('driver/join/index.html','j2.html')
h=open(os.path.join(E,'harness.html')).read().replace('src="mockfb.js"','src="../mockfb.js"')
x=h.replace('src="c.html"','src="c2.html"').replace('src="d.html"','src="d2.html"').replace('src="o.html"','src="o2.html"')
x=x.replace("veh:'auto',plate:'TN 23 Q 0001',model:'Bajaj RE'","veh:'sedan',plate:'TN 23 CA 0001',model:'Maruti Dzire (2024)',year:2024")
x=x.replace("</script></head>","MOCK.store.set('config/app',{dispatch:{win:10,gap:10,fall:true}});\n</script></head>",1)
open(os.path.join(O,'harness_x.html'),'w').write(x)
j=h.replace('src="c.html"','src="j2.html"').replace('src="d.html"','src="d2.html"').replace('src="o.html"','src="o2.html"')
open(os.path.join(O,'harness_j.html'),'w').write(j)
print('built',O)
# app images referenced with ./ paths (place cards); vehicles/ is served the same way
import shutil
for d in ('places','vehicles'):
    src=os.path.join(os.path.dirname(os.path.dirname(E)),d)
    if os.path.isdir(src):shutil.copytree(src,os.path.join(O,d),dirs_exist_ok=True)
