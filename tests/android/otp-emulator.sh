#!/usr/bin/env bash
# Runs on the CI Android emulator (Google APIs image = Google Play services). The debug customer app opens
# tests/android/otptest.html from the test server; we send a real SMS to the emulator and tap the system
# "Allow" (then "Deny" for a second SMS) on Google's consent sheet. The page reports what the app's SmsOtp plugin returned.
set -u
APK=$1; LOG=$2
pass=0; fail=0
ok(){ echo "PASS $1"; pass=$((pass+1)); }
bad(){ echo "FAIL $1"; fail=$((fail+1)); }
waitlog(){ for i in $(seq 1 ${2:-60}); do grep -q "$1" "$LOG" 2>/dev/null && return 0; sleep 1; done; return 1; }
tap_text(){ # tap the first view whose text matches $1 (regex, case-insensitive)
  for i in $(seq 1 40); do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1
    b=$(python3 - "$1" <<'PY'
import re,sys
x=open('/tmp/ui.xml',encoding='utf-8',errors='ignore').read()
for n in re.finditer(r'<node [^>]*>',x):
    t=re.search(r' text="([^"]*)"',n.group(0)).group(1)
    if re.fullmatch(sys.argv[1],t,re.I):
        m=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n.group(0));a=list(map(int,m.groups()))
        print((a[0]+a[2])//2,(a[1]+a[3])//2);break
PY
)
    if [ -n "$b" ]; then adb shell input tap $b; echo "tapped '$1' at $b"; return 0; fi
    sleep 1
  done
  echo "--- screen text:"; grep -o 'text="[^"]*"' /tmp/ui.xml | head -40; return 1
}
adb install -r "$APK" || { echo "FAIL install"; exit 1; }
adb shell am start -n app.velloretaxi/.MainActivity
waitlog "started=first:native" 90 && ok "app opened the test page, SMS reader started (native plugin present)" || { bad "SMS reader did not start"; cat "$LOG"; adb logcat -d | grep -iE "capacitor|smsotp|chromium" | tail -60; exit 1; }
sleep 3
adb emu sms send 6505551212 "123456 is your verification code for velloretaxi.app."
tap_text "allow" && ok "Google's consent sheet shown, Allow tapped" || bad "no consent sheet / Allow button"
waitlog "^first=" 30; got=$(grep "^first=" "$LOG" | tail -1 | cut -d= -f2)
[ "$got" = "123456" ] && ok "after Allow the app got the code 123456" || bad "after Allow: got '$got'"
# second SMS: Deny → no code
adb shell input tap 300 300; waitlog "started=second:native" 30 || bad "second reader did not start"
sleep 3
adb emu sms send 6505551212 "654321 is your verification code for velloretaxi.app."
tap_text "deny|don.t allow" && ok "consent sheet shown again, Deny tapped" || bad "no Deny button"
waitlog "^second=" 30; got=$(grep "^second=" "$LOG" | tail -1 | cut -d= -f2)
[ "$got" = "null" ] && ok "after Deny the app got nothing" || bad "after Deny: got '$got'"
echo "--- report log:"; cat "$LOG"
echo "RESULT $pass passed, $fail failed"
[ $fail -eq 0 ]
