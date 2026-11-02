#!/bin/bash
# iOS Simulator Mobile Safari verification: real booted simulator, real Safari app.
# Load each app, give Render time to wake + app to boot, screenshot, then probe
# rendered state via the simulator screenshot (visual) - reported as SIMULATOR.
set -u
mkdir -p results
echo "== xcode/simulator inventory =="
xcrun simctl list devices available | grep -E 'iPhone' | head -8

DEV=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
best=None
for k,v in sorted(d.items()):
    if "iOS" not in k: continue
    for x in v:
        if "iPhone" in x["name"] and x.get("isAvailable",True):
            best=(k,x["udid"],x["name"])
if best: print(best[1])
')
if [ -z "${DEV:-}" ]; then echo "FAIL: no available iPhone simulator"; exit 1; fi
echo "Using simulator UDID: $DEV"
xcrun simctl boot "$DEV" 2>/dev/null || true
xcrun simctl bootstatus "$DEV" -b
open -a Simulator --args -CurrentDeviceUDID "$DEV" 2>/dev/null || true
sleep 5

APPS="golden-gate-picnic sweet-factory-escape-3d coworking-world seongsu-dogam dalbit-saju-clone kurashi-otaru"
for app in $APPS; do
  echo "== ios load: $app =="
  xcrun simctl openurl "$DEV" "https://$app.onrender.com/"
  sleep 35
  xcrun simctl io "$DEV" screenshot "results/ios-$app.png" && echo "screenshot saved: ios-$app.png"
done
echo "== ios-check done =="
