#!/usr/bin/env bash
# both emulator tests in one emulator session: overlay / duty (ovl-emulator.sh) then 1.0.17 lock screen + phone position (ring-emulator.sh)
APK=$1; LOG=$2; OUT=${3:-/tmp}
bash tests/android/ovl-emulator.sh "$APK" "$LOG" "$OUT"; a=$?
bash tests/android/ring-emulator.sh "$LOG" "$OUT"; b=$?
echo "ovl-emulator exit $a · ring-emulator exit $b"
[ $a -eq 0 ] && [ $b -eq 0 ]
