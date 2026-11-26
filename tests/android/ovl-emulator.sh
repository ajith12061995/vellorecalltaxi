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
# --windows: all windows on screen (the card is a separate, non-focusable window, not part of the app in front)
dump(){ adb shell rm -f /sdcard/ui.xml; adb shell uiautomator dump --windows /sdcard/ui.xml >/dev/null 2>&1 || adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1; }
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

adb logcat -G 16M >/dev/null 2>&1; adb install -r "$APK" || { echo "FAIL install"; exit 1; }
adb shell appops set $PKG SYSTEM_ALERT_WINDOW allow     # what the driver does once on the "Display over other apps" screen
# a driver going ON has already allowed location (the app asks first); and notifications (Android 13+)
adb shell pm grant $PKG android.permission.ACCESS_FINE_LOCATION; adb shell pm grant $PKG android.permission.ACCESS_COARSE_LOCATION; adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS 2>/dev/null
adb shell am start -n $PKG/.MainActivity
waitlog '^status={"can":true}' 90 && ok "app opened; plugin present; overlay permission seen as allowed" || { bad "plugin status"; cat "$LOG"; adb logcat -d | grep -iE "capacitor|RideOverlay|AndroidRuntime" | tail -40; }
waitlog '^online=sent' 20 && ok "page told the plugin: online" || bad "online call"
sleep 2; adb logcat -d | grep -E "DutyService" | tail -5
adb shell dumpsys notification --noredact 2>/dev/null | grep -q "id=4711" && ok "ON → 'Vellore Taxi · Online' notification (duty service running)" || bad "no duty notification"
adb shell input keyevent KEYCODE_HOME; sleep 4          # the driver leaves the app (home screen)
waitlog '^vis=hidden' 10 && ok "app is in the background" || bad "app did not go to the background"
n=$(overlays); [ "$n" -ge 1 ] && ok "floating icon is drawn over the home screen ($n overlay window)" || bad "no floating icon window"
adb exec-out screencap -p > "$OUT/ovl-1-bubble.png" 2>/dev/null
waitlog '^ring=sent' 40 && ok "page asked to ring while in the background: $(grep '^ring=' "$LOG" | tail -1)" || bad "page never asked to ring in the background (page stopped running?)"
sleep 3
has_text "Sedan" && ok "ride card is on screen over the home screen (vehicle Sedan)" || bad "ride card not on screen"
has_text "Katpadi Junction" && has_text "CMC Hospital" && has_text "0.8 km" && has_text "4.3 km" && ok "card shows pickup and drop with km (Rapido-like)" || bad "card has no pickup / drop"
has_text "  (Cash)" && ok "card shows how it is paid" || bad "no payment on the card"
has_text "₹130" && ok "card shows the fare" || bad "card has no fare"
adb exec-out screencap -p > "$OUT/ovl-2-card.png" 2>/dev/null
adb shell dumpsys audio 2>/dev/null | grep -qiE "usage=USAGE_NOTIFICATION_RINGTONE|AudioPlaybackConfiguration.*RINGTONE" && ok "ringtone is playing (system audio shows a ringtone player)" || echo "INFO ringtone player not visible in dumpsys audio (emulator runs with -noaudio); not counted"
ticks=$(grep -c '^tick=.*hidden' "$LOG"); [ "$ticks" -ge 2 ] && ok "page kept running in the background ($ticks ticks while hidden)" || bad "page did not keep running in the background ($ticks ticks)"
tap_text "Accept" && ok "Accept tapped on the card" || bad "no Accept button"
waitlog '^take={"action":"accept","id":"ride42"}' 20 && ok "app came to the front and the page was told: accept ride42" || { bad "page did not get accept"; grep '^take=' "$LOG" | tail -3; }
sleep 2
has_text "Katpadi Junction" && bad "card still on screen after Accept" || ok "card is gone after Accept"
adb exec-out screencap -p > "$OUT/ovl-3-after.png" 2>/dev/null
# 26 Nov (owner's report): the icon came the first time the app was left, but not again after going back in and out.
# The driver goes in and out several times: by tapping the icon, from the launcher, and from the recent-apps list.
dens=$(adb shell wm density | grep -o '[0-9]*' | tail -1); ix=$(( (6+26)*dens/160 )); iy=$(( (220+26)*dens/160 ))
for k in 1 2 3 4 5; do
  if [ $k -eq 5 ]; then adb shell input keyevent KEYCODE_BACK; sleep 3; else adb shell input keyevent KEYCODE_HOME; sleep 3; fi
  n=$(overlays); [ "$n" -ge 1 ] && ok "round $k: icon back over the home screen after leaving the app again ($([ $k -eq 5 ] && echo Back || echo Home))" || { bad "round $k: NO icon after leaving the app again"; adb logcat -d | grep -E "RideOverlay: (pause|resume|destroy|load)|DutyService: icon" | tail -8; }
  [ $k -eq 2 ] && adb exec-out screencap -p > "$OUT/ovl-4-again.png" 2>/dev/null
  case $k in
    1) adb shell input tap $ix $iy; how="tapping the icon";;
    2) adb shell am start -n $PKG/.MainActivity >/dev/null; how="the launcher";;
    3) adb shell input keyevent KEYCODE_APP_SWITCH; sleep 2; adb shell input keyevent KEYCODE_APP_SWITCH; how="recent apps";;
    4) adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; how="the app icon";;
    5) t0=$(grep -c '^tick=.*hidden' "$LOG"); sleep 4; t1=$(grep -c '^tick=.*hidden' "$LOG")
       [ "$t1" -gt "$t0" ] && ok "after Back the page keeps running in the background ($t0 → $t1 ticks)" || bad "after Back the page stopped ($t0 → $t1 ticks)"
       echo "--- after Back:"; adb shell pidof $PKG; adb shell dumpsys activity activities 2>/dev/null | grep -E "velloretaxi" | head -5
       adb logcat -d -b main,system,events 2>/dev/null | grep -iE "velloretaxi|am_kill|am_proc_died|has died|Killing|am_finish|wm_finish|wm_destroy|onBackPressed|moveTaskToBack" | tail -25
       adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; how="the app icon after Back";;
  esac
  sleep 3; n=$(overlays); [ "$n" -eq 0 ] && ok "round $k: back in the app ($how): icon hidden" || { bad "round $k: icon still drawn inside the app ($n) after $how"; adb logcat -d | grep -E "RideOverlay: (pause|resume|destroy|load)|DutyService: icon" | tail -8; adb shell dumpsys activity activities | grep -E "ResumedActivity" | head -2; }
done
# 26 Nov (owner's recording of Rapido): swiped away from recent apps / killed → the app comes back by itself, behind the
# other app, the icon is there again and the page runs again. The driver does nothing.
boots(){ grep -c '^boot=' "$LOG"; }
alive(){ adb shell pidof $PKG | tr -d '\r'; }
front(){ adb shell dumpsys activity activities 2>/dev/null | grep -E "mResumedActivity|topResumedActivity" | head -1; }
adb shell input keyevent KEYCODE_HOME; sleep 3
b0=$(boots)
adb shell input keyevent KEYCODE_APP_SWITCH; sleep 3
adb exec-out screencap -p > "$OUT/ovl-5-recents.png" 2>/dev/null
intask(){ adb shell dumpsys activity recents 2>/dev/null | grep -c "Recent #.*velloretaxi"; }
echo "app tasks before: $(intask)"
W=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1); w=${W%x*}; hh=${W#*x}; how=""
if tap_text "Clear all" >/dev/null 2>&1; then how="Clear all"; fi
k=0; for d in 150 300 100; do [ "$(boots)" -gt "$b0" ] && break; adb logcat -d | grep -q "DutyService: task removed" && break
  k=$((k+1)); if [ $k -gt 1 ]; then adb shell input keyevent KEYCODE_HOME; sleep 1; adb shell input keyevent KEYCODE_APP_SWITCH; sleep 2; fi
  adb shell input touchscreen swipe $((w/2)) $((hh*45/100)) $((w/2)) 5 $d; sleep 2; how="$how swipe-up($d)"; done
echo "recent apps: $how · app tasks after: $(intask)"; sleep 1; adb shell input keyevent KEYCODE_HOME
for i in $(seq 1 40); do [ "$(boots)" -gt "$b0" ] && break; sleep 1; done
adb logcat -d | grep -E "DutyService" | tail -8
[ "$(boots)" -gt "$b0" ] && ok "swiped away ($how) → app reopened by itself, page running again (boot $(boots))" || bad "swiped away ($how) → app did NOT come back"
waitlog "^ready=sent:$(boots)" 25 && ok "page said ready" || bad "page never said ready after the reopen"
sleep 3; f=$(front); echo "in front: $f"
echo "$f" | grep -q velloretaxi && bad "reopened app stayed in front of the driver's screen" || ok "reopened app went to the background by itself"
n=$(overlays); [ "$n" -ge 1 ] && ok "icon is there again after being swiped away" || bad "no icon after being swiped away"
adb exec-out screencap -p > "$OUT/ovl-6-after-swipe.png" 2>/dev/null
t0=$(grep -c '^tick=.*hidden' "$LOG"); sleep 7; t1=$(grep -c '^tick=.*hidden' "$LOG")
[ "$t1" -gt "$t0" ] && ok "page keeps running in the background after the reopen ($t0 → $t1)" || bad "page not running after the reopen ($t0 → $t1)"
# the system kills the app's process (memory cleaner)
p0=$(alive); b1=$(boots); adb root >/dev/null 2>&1; sleep 2; adb shell kill -9 $p0 2>/dev/null || adb shell su 0 kill -9 $p0
echo "killed pid $p0"
for i in $(seq 1 90); do [ "$(boots)" -gt "$b1" ] && break; sleep 1; done
adb logcat -d | grep -E "DutyService|velloretaxi.*(Scheduling restart|restart)" | tail -8
[ "$(boots)" -gt "$b1" ] && ok "process killed → app came back by itself (new pid $(alive), boot $(boots))" || bad "process killed → app did NOT come back within 90 s"
sleep 8; n=$(overlays); [ "$n" -ge 1 ] && ok "icon is there after the kill" || bad "no icon after the kill"
f=$(front); echo "$f" | grep -q velloretaxi && bad "app left in front after the kill" || ok "app in the background after the kill"
adb exec-out screencap -p > "$OUT/ovl-7-after-kill.png" 2>/dev/null
# OFF: the driver switches off → notification and icon gone, and nothing comes back
adb shell am start -n $PKG/.MainActivity >/dev/null; sleep 4
echo off > tests/android/cmd.txt
waitlog '^off=sent' 20 && ok "page switched the driver OFF" || bad "OFF not sent"
sleep 2; adb shell dumpsys notification --noredact 2>/dev/null | grep -q "id=4711" && bad "duty notification still there after OFF" || ok "OFF → duty notification gone"
adb shell input keyevent KEYCODE_HOME; sleep 4
n=$(overlays); [ "$n" -eq 0 ] && ok "OFF → no icon over the home screen" || bad "icon drawn while OFF ($n)"
b2=$(boots); adb shell input keyevent KEYCODE_APP_SWITCH; sleep 3
tap_text "Clear all" >/dev/null || { W=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1); w=${W%x*}; hh=${W#*x}; adb shell input swipe $((w/2)) $((hh/2)) $((w/2)) 80 250; }
adb shell input keyevent KEYCODE_HOME; sleep 15
[ "$(boots)" -eq "$b2" ] && ok "OFF → swiped away stays closed (not reopened)" || bad "OFF but the app was reopened"
rm -f tests/android/cmd.txt
adb shell am start -n $PKG/.MainActivity >/dev/null; sleep 6
# without the permission nothing may be drawn
adb shell appops set $PKG SYSTEM_ALERT_WINDOW deny
adb shell input keyevent KEYCODE_HOME; sleep 4
n=$(overlays); [ "$n" -eq 0 ] && ok "permission taken away: nothing is drawn over other apps" || bad "overlay drawn without permission ($n)"
echo "--- report log:"; cat "$LOG"
echo "--- windows of the app:"; adb shell dumpsys window windows 2>/dev/null | grep -E "Window\{[^}]*$PKG" | head
echo "--- logcat:"; adb logcat -d | grep -iE "DutyService|AndroidRuntime: (FATAL|Shutting down VM.*velloretaxi)|FATAL|RideOverlay: (load|resume|pause|destroy|sync|online)|wm_on_(create|destroy|resume|paused|stop).*velloretaxi|START u0.*velloretaxi" | tail -80
echo "--- crash buffer:"; adb logcat -d -b crash | tail -40
echo "--- process deaths:"; adb logcat -d -b events | grep -E "am_kill|am_proc_died|am_crash|am_anr" | grep -i velloretaxi | tail -10
echo "RESULT $pass passed, $fail failed"
[ $fail -eq 0 ]
