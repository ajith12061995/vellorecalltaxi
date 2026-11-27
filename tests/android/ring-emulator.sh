#!/usr/bin/env bash
# 1.0.17 on a real Android (CI emulator, API 34), after ovl-emulator.sh in the same emulator:
#  A) NativeLive: with the app NOT on screen, the phone itself sends the position (token swap + Firestore commit to the
#     test server's stand-ins); nothing is sent while the app is on screen; it moves with the GPS; it stops at OFF.
#  B) Lock screen: screen off + locked, a server push arrives → the page is woken, rings → the ride shows OVER THE LOCK
#     SCREEN with the screen turned on; Accept → the app opens and the page is told "accept" for that ride.
#  C) The same without "Display over other apps" (full-screen notification route).
set -u
LOG=$1; OUT=${2:-/tmp}
PKG=app.velloretaxi.driver
pass=0; fail=0; n=0
ok(){ echo "PASS $1"; pass=$((pass+1)); }
bad(){ echo "FAIL $1"; fail=$((fail+1)); }
waitlog(){ for i in $(seq 1 ${2:-60}); do grep -q "$1" "$LOG" 2>/dev/null && return 0; sleep 1; done; return 1; }
cmd(){ n=$((n+1)); echo "$n:$1" > tests/android/cmd.txt; }
commits(){ grep -c '^commit=' "$LOG"; }
dump(){ adb shell rm -f /sdcard/ui.xml; adb shell uiautomator dump --windows /sdcard/ui.xml >/dev/null 2>&1 || adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1; }
has_text(){ dump; grep -q "text=\"$1\"" /tmp/ui.xml; }
tap_text(){ for i in $(seq 1 15); do dump
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
    if [ -n "$b" ]; then adb shell input tap $b; echo "tapped '$1' at $b"; return 0; fi; sleep 1; done; return 1; }
awake(){ adb shell dumpsys power 2>/dev/null | grep -q "mWakefulness=Awake"; }
kg(){ adb shell dumpsys window 2>/dev/null | grep -qE "mDreamingLockscreen=true|isKeyguardShowing=true|mShowingLockscreen=true|KeyguardController.*mKeyguardShowing=true" ; }
topact(){ adb shell dumpsys activity activities 2>/dev/null | grep -E "topResumedActivity|mResumedActivity" | head -1; }

rm -f tests/android/cmd.txt
adb shell appops set $PKG SYSTEM_ALERT_WINDOW allow
adb shell locksettings set-disabled false >/dev/null 2>&1
adb shell am start -n $PKG/.MainActivity >/dev/null; sleep 6
cmd on; waitlog '^on2=sent' 20 && ok "driver ON again" || bad "ON not sent"
cmd voice; waitlog '^voice=' 15 && ok "voice(): $(grep '^voice=' "$LOG" | tail -1) (empty = this emulator has no text-to-speech voice; the ringtone then starts at once)" || bad "voice() missing"
cmd fsi; waitlog '^fsi=' 15 && ok "fsi(): $(grep '^fsi=' "$LOG" | tail -1)" || bad "fsi() missing (not a 1.0.17 build?)"

# ---------- A) position from the phone itself ----------
adb emu geo fix 79.1590 12.9716 >/dev/null 2>&1
cmd live; waitlog '^live=sent' 20 && ok "page handed the sign-in to the phone (liveStart)" || bad "liveStart failed: $(grep '^live=' "$LOG" | tail -1)"
c0=$(commits); sleep 12
[ "$(commits)" -eq "$c0" ] && ok "app on screen: the phone does not send (the page does)" || bad "phone sent while the app was on screen ($c0 → $(commits))"
adb shell input keyevent KEYCODE_HOME
for i in $(seq 1 40); do [ "$(commits)" -gt "$c0" ] && break; sleep 1; done
[ "$(commits)" -gt "$c0" ] && ok "app left (home screen): the phone sends the position itself" || { bad "no position sent from the phone after leaving the app"; cmd livestatus; sleep 3; grep '^livestatus=' "$LOG" | tail -1; adb logcat -d | grep -E "NativeLive|DutyService" | tail -15; }
grep -q '^token=grant_type=refresh_token&refresh_token=rt-test' "$LOG" && ok "sign-in token swapped at the token endpoint (refresh token from the page)" || bad "no token swap seen"
L1=$(grep '^commit=' "$LOG" | tail -1)
echo "$L1" | grep -q '^commit=Bearer idt-test ' && ok "write is signed with the ID token (database rules apply)" || bad "write not signed: ${L1:0:80}"
echo "$L1" | sed 's#\\/#/#g' | grep -q 'documents/live/+919999900002"' && ok "writes this driver's live/{phone} record" || bad "wrong record: ${L1:0:200}"
echo "$L1" | python3 -c "
import sys,json;l=sys.stdin.read();j=json.loads(l[l.index('{'):]);w=j['writes'][0];f=w['update']['fields']
assert abs(f['lat']['doubleValue']-12.9716)<0.001 and abs(f['lon']['doubleValue']-79.159)<0.001, f
assert len(f['gh']['stringValue'])==7
assert f['online']['booleanValue'] is True
assert sorted(w['updateMask']['fieldPaths'])==sorted(['lat','lon','gh','hd','sp','acc','online','bat','chg','pwr']), w['updateMask']
assert w['updateTransforms'][0]=={'fieldPath':'updatedAt','setToServerValue':'REQUEST_TIME'}
print('gh',f['gh']['stringValue'])" && ok "position, geohash, online, server time; busy / bk / veh left to the page (update mask)" || bad "write body wrong"
GH=$(python3 -c "
B='0123456789bcdefghjkmnpqrstuvwxyz'
def gh(lat,lon,p=7):
  la=[-90,90];lo=[-180,180];h='';bit=0;ch=0;ev=True
  while len(h)<p:
    r=lo if ev else la;v=lon if ev else lat;mid=(r[0]+r[1])/2
    if v>=mid: ch=ch*2+1;r[0]=mid
    else: ch=ch*2;r[1]=mid
    ev=not ev;bit+=1
    if bit==5: h+=B[ch];bit=0;ch=0
  return h
print(gh(12.9716,79.159))")
echo "$L1" | grep -q "\"stringValue\":\"$GH\"" && ok "geohash is the same as the page's ($GH)" || bad "geohash differs from the page's ($GH): ${L1:0:300}"
c1=$(commits); for k in 1 2 3; do adb emu geo fix 79.1700 12.9850 30 >/dev/null 2>&1; sleep 2; done
adb shell dumpsys location 2>/dev/null | grep -iE "last location|Location\[gps" | head -4
for i in $(seq 1 25); do [ "$(commits)" -gt "$c1" ] && grep '^commit=' "$LOG" | tail -1 | grep -qE '"lat":\{"doubleValue":12\.98[45]' && break; sleep 1; done
grep '^commit=' "$LOG" | tail -1 | grep -qE '"lat":\{"doubleValue":12\.98[45]' && ok "driver moves → new position sent" || { bad "moved position not sent"; grep '^commit=' "$LOG" | grep -o '"lat":{"doubleValue":[0-9.]*' | uniq -c; adb logcat -d | grep "NativeLive: fix" | tail -6; }
adb emu power capacity 37 >/dev/null 2>&1; adb emu power status discharging >/dev/null 2>&1; sleep 1
c2=$(commits); sleep 35
grep '^commit=' "$LOG" | tail -1 | grep -q '"bat":{"integerValue":"37"}' && ok "battery % goes with the position (37%)" || bad "no battery % in the write: $(grep '^commit=' "$LOG" | tail -1 | grep -o '"bat":[^}]*}' )"
grep '^commit=' "$LOG" | tail -1 | grep -q '"pwr":{"stringValue":"on"}' && grep '^commit=' "$LOG" | tail -1 | grep -q '"chg":{"booleanValue":false}' && ok "phone on, not charging" || bad "pwr / chg missing"
# the phone is being switched off: one last write says so (system broadcast if the emulator lets us send it, else the same code path)
c4=$(commits); adb root >/dev/null 2>&1; sleep 2; adb shell am broadcast -a android.intent.action.ACTION_SHUTDOWN >/dev/null 2>&1
for i in $(seq 1 8); do grep '^commit=' "$LOG" | tail -3 | grep -q '"pwr":{"stringValue":"off"}' && break; sleep 1; done
if grep '^commit=' "$LOG" | tail -3 | grep -q '"pwr":{"stringValue":"off"}'; then ok "power-off broadcast → 'phone switched off' sent at once (real system broadcast)"
else echo "INFO the emulator did not deliver ACTION_SHUTDOWN from the shell; using the same code path"; cmd shutdown; waitlog '^shutdown=sent' 15
  for i in $(seq 1 10); do grep '^commit=' "$LOG" | tail -3 | grep -q '"pwr":{"stringValue":"off"}' && break; sleep 1; done
  grep '^commit=' "$LOG" | tail -3 | grep -q '"pwr":{"stringValue":"off"}' && ok "switching off → 'phone switched off' sent at once" || bad "no 'switched off' write"; fi
grep '^commit=' "$LOG" | grep '"pwr":{"stringValue":"off"}' | tail -1 | grep -q '"fieldPaths":\["pwr","bat"\]' && ok "the switched-off write changes only pwr and battery" || bad "switched-off write mask wrong"
sleep 31; grep '^commit=' "$LOG" | tail -1 | grep -q '"pwr":{"stringValue":"on"}' && ok "still running (emulator not really off): next write says on again" || bad "no 'on' write after"
c2=$(commits); sleep 35
[ "$(commits)" -gt "$c2" ] && ok "standing still: signal still sent at least every 30 s ($c2 → $(commits))" || bad "no heartbeat while standing ($c2 → $(commits))"
adb exec-out screencap -p > "$OUT/ring-0-home.png" 2>/dev/null

# ---------- B) ride over the lock screen ----------
cmd push-r77; waitlog '^push=sent:push-r77' 20 && ok "server push queued (arrives in 12 s)" || bad "testPush failed: $(grep '^push=' "$LOG" | tail -1)"
adb shell input keyevent KEYCODE_SLEEP; sleep 3
awake && bad "screen did not turn off" || ok "screen off, phone locked"
for i in $(seq 1 30); do grep -q '^ring2=sent' "$LOG" && break; sleep 1; done
grep -q '^wake=push-r77' "$LOG" && ok "push woke the page while the screen was off" || bad "page was not woken"
sleep 4
awake && ok "the ride turned the screen on" || bad "screen stayed off"
t=$(topact); echo "top: $t"
echo "$t" | grep -q RideRingActivity && ok "ride screen is in front, over the lock screen" || bad "ride screen not in front"
has_text "Katpadi Junction" && has_text "₹150" && has_text "Accept" && ok "ride, fare and Accept are on the lock screen" || { bad "ride details not on screen"; grep -o 'text="[^"]*"' /tmp/ui.xml | head -20; }
adb exec-out screencap -p > "$OUT/ring-1-lockscreen.png" 2>/dev/null
adb shell dumpsys notification --noredact 2>/dev/null | grep -q "id=4712" && ok "full-screen ride notification posted (category call)" || echo "INFO no 4712 notification seen"
tap_text "Accept" && ok "Accept tapped on the lock screen" || bad "no Accept on the lock screen"
sleep 3; adb shell wm dismiss-keyguard >/dev/null 2>&1; sleep 4   # the driver unlocks (fingerprint / PIN / swipe)
waitlog '^take={"action":"accept","id":"push-r77"}' 25 && ok "after unlocking, the app opened and the page was told: accept push-r77" || { bad "page did not get accept"; grep '^take=' "$LOG" | tail -3; topact; }
adb exec-out screencap -p > "$OUT/ring-2-after-accept.png" 2>/dev/null
adb shell dumpsys notification --noredact 2>/dev/null | grep -q "id=4712" && bad "ride notification left behind" || ok "ride notification cleared"

# ---------- C) without "Display over other apps": the full-screen notification route ----------
adb shell appops get $PKG USE_FULL_SCREEN_INTENT 2>/dev/null | head -1
adb shell appops set $PKG SYSTEM_ALERT_WINDOW deny
adb shell input keyevent KEYCODE_HOME; sleep 2
cmd push-r88; waitlog '^push=sent:push-r88' 20 || bad "second push not queued"
adb shell input keyevent KEYCODE_SLEEP; sleep 3
for i in $(seq 1 30); do grep -q '^wake=push-r88' "$LOG" && break; sleep 1; done; sleep 5
t=$(topact); echo "top: $t"
(awake && echo "$t" | grep -q RideRingActivity) && ok "no overlay permission: the full-screen notification still brings the ride over the lock screen" || bad "full-screen route did not show the ride (awake=$(awake && echo y || echo n))"
adb exec-out screencap -p > "$OUT/ring-3-fsi.png" 2>/dev/null
tap_text "Later" && ok "Later: quiet, request stays in the app" || bad "no Later button"
sleep 2; t=$(topact); echo "$t" | grep -q RideRingActivity && bad "ride screen still there after Later" || ok "ride screen closed after Later"
adb shell appops set $PKG SYSTEM_ALERT_WINDOW allow
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard >/dev/null 2>&1; sleep 2

# ---------- E) 1.0.20: after a long sleep (Doze) the page does not answer the push → the phone rings by itself ----------
adb shell input keyevent KEYCODE_HOME; sleep 2
adb logcat -c
adb shell dumpsys deviceidle force-idle 2>/dev/null | head -1
adb shell dumpsys deviceidle tempwhitelist -d 60000 $PKG >/dev/null 2>&1   # what a high-priority push grants the app
cmd push-deaf1; waitlog '^push=sent:push-deaf1' 20 || bad "deaf push not queued"
adb shell input keyevent KEYCODE_SLEEP; sleep 3
for i in $(seq 1 40); do adb logcat -d | grep -q "RideFallback: fallback ring push-deaf1" && break; sleep 1; done
adb logcat -d | grep -q "RideFallback: fallback ring push-deaf1" && ok "page silent (asleep): the phone read the ride and rang by itself" || { bad "no fallback ring"; adb logcat -d | grep -E "RideFallback|NativeLive|VctPush" | tail -15; }
grep '^commit=' "$LOG" | grep -q '"pk":{"stringValue":"push-deaf1"}' && grep '^commit=' "$LOG" | grep 'push-deaf1' | grep -q '"fieldPath":"pkAt","setToServerValue":"REQUEST_TIME"' && ok "the phone told the server it got the push (pk + server time)" || bad "no push receipt: $(grep '^commit=' "$LOG" | grep -o '"pk"[^}]*}' | tail -1)"
grep -q '^read=Bearer idt-test push-deaf1' "$LOG" && ok "it read the ride from the server, signed in as the driver (rules apply)" || bad "ride not read: $(grep '^read=' "$LOG" | tail -1)"
grep '^query=' "$LOG" | tail -1 | grep -q '"driverPhone"' && ok "it checked the driver is not already on a ride" || bad "no busy check"
sleep 3; awake && ok "screen turned on" || bad "screen stayed off"
t=$(topact); echo "top: $t"; echo "$t" | grep -q RideRingActivity && ok "ride over the lock screen (from the push itself)" || bad "ride screen not in front"
has_text "Katpadi Junction" && has_text "₹150" && ok "pickup and fare from the push are shown" || { bad "details missing"; grep -o 'text="[^"]*"' /tmp/ui.xml | head -20; }
adb exec-out screencap -p > "$OUT/ring-4-fallback.png" 2>/dev/null
tap_text "Accept" && ok "Accept tapped" || bad "no Accept"
sleep 3; adb shell wm dismiss-keyguard >/dev/null 2>&1; sleep 4
waitlog '^take={"action":"accept","id":"push-deaf1"}' 25 && ok "app opened; the page is told: accept push-deaf1 (it accepts with its own checks)" || { bad "accept not passed to the page"; grep '^take=' "$LOG" | tail -2; }
adb shell input keyevent KEYCODE_HOME; sleep 2; adb logcat -c
adb shell dumpsys deviceidle tempwhitelist -d 60000 $PKG >/dev/null 2>&1
cmd push-gone2; waitlog '^push=sent:push-gone2' 20 || bad "gone push not queued"
adb shell input keyevent KEYCODE_SLEEP; sleep 3
for i in $(seq 1 30); do adb logcat -d | grep -q "RideFallback: no ring push-gone2" && break; sleep 1; done
adb logcat -d | grep -q "RideFallback: no ring push-gone2: status:assigned" && ok "ride already taken by someone else: the phone does not ring" || { bad "taken ride: wrong decision"; adb logcat -d | grep RideFallback | tail -5; }
awake && bad "screen turned on for a taken ride" || ok "screen stays off for it"
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard >/dev/null 2>&1; sleep 1; adb shell input keyevent KEYCODE_HOME; sleep 2; adb logcat -c
adb shell dumpsys deviceidle tempwhitelist -d 60000 $PKG >/dev/null 2>&1
cmd push-far3; waitlog '^push=sent:push-far3' 20 || bad "far push not queued"
for i in $(seq 1 30); do adb logcat -d | grep -q "RideFallback: no ring push-far3" && break; sleep 1; done
adb logcat -d | grep -q "RideFallback: no ring push-far3: far" && ok "pickup more than 4 km away: no ring (same as the page)" || { bad "far ride: wrong decision"; adb logcat -d | grep RideFallback | tail -5; }
adb logcat -c
cmd push-r99; waitlog '^push=sent:push-r99' 20 || bad "normal push not queued"
for i in $(seq 1 30); do adb logcat -d | grep -q "RideFallback: page handled push-r99" && break; sleep 1; done
adb logcat -d | grep -q "RideFallback: page handled push-r99" && ok "page awake and rang: the phone does not ring it a second time" || { bad "page-rung ride not marked"; adb logcat -d | grep RideFallback | tail -5; }
adb shell dumpsys deviceidle unforce >/dev/null 2>&1
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard >/dev/null 2>&1; sleep 2

# ---------- OFF stops the phone's own sending ----------
adb shell am start -n $PKG/.MainActivity >/dev/null; sleep 4
echo off > tests/android/cmd.txt; sleep 4; adb shell input keyevent KEYCODE_HOME
c3=$(commits); sleep 40
[ "$(commits)" -eq "$c3" ] && ok "OFF: the phone stops sending the position" || bad "position still sent after OFF ($c3 → $(commits))"
rm -f tests/android/cmd.txt
echo "--- report log (1.0.17 part):"; grep -vE "^(tick|commit)=" "$LOG" | tail -40
echo "--- NativeLive / RideRing / VctPush / voice log:"; adb logcat -d | grep -E "NativeLive: (started|stopped|write|token)|RideRing|RideFallback|VctPush|RideOverlay: (ring|wake|tts)" | tail -60
echo "--- crash buffer:"; adb logcat -d -b crash | tail -30
echo "RESULT $pass passed, $fail failed"
[ $fail -eq 0 ]
