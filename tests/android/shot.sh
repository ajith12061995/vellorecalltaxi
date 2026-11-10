#!/usr/bin/env bash
# screenshots of the customer app opening velloretaxi.app + the width the page sees (via WebView DevTools)
APK=$1; OUT=$2; mkdir -p "$OUT"
adb install -r "$APK" >/dev/null && echo installed
adb shell dumpsys webviewupdate | grep -iE "current webview package|versionName" | head -3 | tee "$OUT/webview.txt"
adb shell wm size | tee -a "$OUT/webview.txt"; adb shell wm density | tee -a "$OUT/webview.txt"
adb shell am start -n app.velloretaxi/.MainActivity
for t in 2 5 9 15 25; do sleep $([ $t = 2 ] && echo 2 || echo 4); adb exec-out screencap -p > "$OUT/t$t.png"; done
# page metrics through the WebView DevTools socket
pid=$(adb shell pidof app.velloretaxi | tr -d '\r'); adb forward tcp:9222 localabstract:webview_devtools_remote_$pid >/dev/null
curl -s http://localhost:9222/json | tee "$OUT/pages.json" | head -c 600; echo
ws=$(python3 -c "import json;print([p for p in json.load(open('$OUT/pages.json')) if 'velloretaxi' in p['url']][0]['webSocketDebuggerUrl'])")
npm i -g wscat >/dev/null 2>&1 || true
python3 - "$ws" "$OUT/metrics.txt" <<'PY'
import sys,json,asyncio
async def main():
    try:
        import websockets
    except ImportError:
        import subprocess;subprocess.run([sys.executable,'-m','pip','install','-q','websockets'],check=True);import websockets
    async with websockets.connect(sys.argv[1],max_size=None) as w:
        expr="JSON.stringify({ua:navigator.userAgent,iw:innerWidth,ih:innerHeight,cw:document.documentElement.clientWidth,dpr:devicePixelRatio,vp:(document.querySelector('meta[name=viewport]')||{}).content,wide:matchMedia('(min-width:520px)').matches,v:window.VCT_V,head:document.head.innerHTML.slice(0,400)})"
        await w.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expr}}))
        r=json.loads(await w.recv());v=r['result']['result'].get('value');print(v);open(sys.argv[2],'w').write(str(v))
asyncio.run(main())
PY
ls -la "$OUT"
