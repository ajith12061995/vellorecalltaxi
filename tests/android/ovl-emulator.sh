#!/usr/bin/env bash
# Runs on the CI Android emulator. The debug DRIVER app opens tests/android/ovltest.html, which drives the RideOverlay
# plugin like the real driver page. We put the app in the background and check on a real Android system that:
#   the page keeps running, the floating icon and then the ride card are drawn over the home screen, the card shows the
#   ride, "Accept" brings the app back and the page is told "accept" for that ride.
set -u
APK=$1; LOG=$2; OUT=${3:-/tmp}
PKG=app.velloretaxi.driver
pass=0; fail=0
ok(){ echo "PASS $1"; pass=$((pass+1)); }
bad(){ echo "FAIL $1"; fail=$((fail+1)); }
waitlog(){ for i in $(seq 1 ${2:-60}); do grep -q "$1" "$LOG" 2>/dev/null && return 0; sleep 1; done; return 1; }
dump(){ adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1; }
has_text(){ dump; grep -q "text=\"$1\"" /tmp/ui.xml; }
tap_text(){ for i in $(seq 1 20); do dump
    b=$(python3 - "$1" <<'PY'
import re,sys
x=open('/tmp/ui.xml',encoding='utf-8',errors='ignore').read()
for n in re.finditer(r'<node [^>]*>',x):
    t=re.search(r' text="([^"]*)"',n.group(0)).group(1)
    if t==sys.argv[1]:
        m=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n.group(0));a=list(map(int,m.groups()))
        print((a[0]+a[2])//2,(a[1]+a[3])//2);break
PY
)
    if [ -n "$b" ]; then adb shell input tap $b; echo "tapped '$1' at $b"; return 0; fi; sleep 1; done
  echo "--- screen text:"; grep -o 'text="[^"]*"' /tmp/ui.xml | head -40; return 1; }
overlays(){ adb shell dumpsys window windows 2>/dev/null | grep -E "Window\{[^}]*$PKG" | grep -vc "MainActivity"; }

adb install -r "$APK" || { echo "FAIL install"; exit 1; }
adb shell appops set $PKG SYSTEM_ALERT_WINDOW allow     # what the driver does once on the "Display over other apps" screen
adb shell am start -n $PKG/.MainActivity
waitlog '^status={"can":true}' 90 && ok "app opened; plugin present; overlay permission seen as allowed" || { bad "plugin status"; cat "$LOG"; adb logcat -d | grep -iE "capacitor|RideOverlay|AndroidRuntime" | tail -40; }
waitlog '^online=sent' 20 && ok "page told the plugin: online" || bad "online call"
adb shell input keyevent KEYCODE_HOME; sleep 4          # the driver leaves the app (home screen)
waitlog '^vis=hidden' 10 && ok "app is in the background" || bad "app did not go to the background"
n=$(overlays); [ "$n" -ge 1 ] && ok "floating icon is drawn over the home screen ($n overlay window)" || bad "no floating icon window"
adb exec-out screencap -p > "$OUT/ovl-1-bubble.png" 2>/dev/null
waitlog '^ring=sent' 40 && ok "page asked to ring while in the background: $(grep '^ring=' "$LOG" | tail -1)" || bad "page never asked to ring in the background (page stopped running?)"
sleep 3
has_text "New ride!" && ok "ride card is on screen over the home screen" || bad "ride card not on screen"
has_text "Katpadi Junction → CMC Hospital" && ok "card shows pickup → drop" || bad "card has no route line"
has_text "₹130" && ok "card shows the fare" || bad "card has no fare"
adb exec-out screencap -p > "$OUT/ovl-2-card.png" 2>/dev/null
adb shell dumpsys audio 2>/dev/null | grep -qiE "usage=USAGE_NOTIFICATION_RINGTONE|AudioPlaybackConfiguration.*RINGTONE" && ok "ringtone is playing (system audio shows a ringtone player)" || echo "INFO ringtone player not visible in dumpsys audio (emulator runs with -noaudio); not counted"
ticks=$(grep -c '^tick=.*hidden' "$LOG"); [ "$ticks" -ge 2 ] && ok "page kept running in the background ($ticks ticks while hidden)" || bad "page did not keep running in the background ($ticks ticks)"
tap_text "Accept" && ok "Accept tapped on the card" || bad "no Accept button"
waitlog '^take={"action":"accept","id":"ride42"}' 20 && ok "app came to the front and the page was told: accept ride42" || { bad "page did not get accept"; grep '^take=' "$LOG" | tail -3; }
sleep 2
has_text "New ride!" && bad "card still on screen after Accept" || ok "card is gone after Accept"
adb exec-out screencap -p > "$OUT/ovl-3-after.png" 2>/dev/null
# without the permission nothing may be drawn
adb shell appops set $PKG SYSTEM_ALERT_WINDOW deny
adb shell input keyevent KEYCODE_HOME; sleep 4
n=$(overlays); [ "$n" -eq 0 ] && ok "permission taken away: nothing is drawn over other apps" || bad "overlay drawn without permission ($n)"
echo "--- report log:"; cat "$LOG"
adb logcat -d | grep -iE "AndroidRuntime|FATAL" | tail -10
echo "RESULT $pass passed, $fail failed"
[ $fail -eq 0 ]
