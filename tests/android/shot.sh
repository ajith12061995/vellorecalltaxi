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
node -e '
const ws=new WebSocket(process.argv[1]);
const expr="JSON.stringify({ua:navigator.userAgent,iw:innerWidth,ih:innerHeight,cw:document.documentElement.clientWidth,dpr:devicePixelRatio,vp:(document.querySelector(\"meta[name=viewport]\")||{}).content,wide:matchMedia(\"(min-width:520px)\").matches,v:window.VCT_V})";
ws.onopen=()=>ws.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{expression:expr}}));
ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id===1){console.log("METRICS",r.result.result.value);process.exit(0)}};
setTimeout(()=>{console.log("METRICS timeout");process.exit(0)},15000);' "$ws"
ls -la "$OUT"
