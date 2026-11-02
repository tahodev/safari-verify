#!/bin/bash
# iOS Simulator Mobile Safari verification: booted simulator + real Safari app,
# real taps via idb, element positions via Web Inspector (IWDP) + pixel calibration.
set -u
mkdir -p results
echo "== simulator inventory =="
xcrun simctl list devices available | grep -E 'iPhone' | head -8
DEV=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
best=None
for k,v in sorted(d.items()):
    if "iOS" not in k: continue
    for x in v:
        if "iPhone" in x["name"] and x.get("isAvailable",True):
            best=x["udid"]
if best: print(best)
')
if [ -z "${DEV:-}" ]; then echo "FAIL: no available iPhone simulator"; exit 1; fi
echo "Using simulator UDID: $DEV"
xcrun simctl boot "$DEV" 2>/dev/null || true
xcrun simctl bootstatus "$DEV" -b
open -a Simulator --args -CurrentDeviceUDID "$DEV" 2>/dev/null || true
sleep 5

INTERACT_OK=0
echo "== installing interaction tooling (idb + ios-webkit-debug-proxy) =="
if (brew install ios-webkit-debug-proxy && brew install --cask companion) >/tmp/ios-brew.log 2>&1 || { command -v idb_companion >/dev/null && command -v ios_webkit_debug_proxy >/dev/null; }; then
  if pip3 install --quiet --user fb-idb websocket-client pillow >/tmp/ios-pip.log 2>&1 || python3 -c 'import websocket, PIL' 2>/dev/null; then
    export PATH="$HOME/Library/Python/3.9/bin:$PATH"
    if command -v idb >/dev/null && idb list-targets 2>/dev/null | grep -qi "$DEV"; then
      ios_webkit_debug_proxy -c "$DEV:9221" >/tmp/iwdp.log 2>&1 &
      IWDP_PID=$!
      sleep 4
      INTERACT_OK=1
    else
      echo "idb not functional; falling back to load+screenshot only"
    fi
  else
    echo "pip tooling failed; falling back to load+screenshot only"
    tail -3 /tmp/ios-pip.log || true
  fi
else
  echo "brew install failed; falling back to load+screenshot only"
  tail -6 /tmp/ios-brew.log || true
fi

if [ "$INTERACT_OK" = "1" ]; then
  echo "== running real-tap interaction checks =="
  python3 ios-interact.py "$DEV" 2>&1; IOS_RC=$?
  kill $IWDP_PID 2>/dev/null || true
  [ "${IOS_RC:-1}" = "0" ] || exit 1
else
  echo "== LOAD-ONLY fallback (interaction tooling unavailable) =="
  for app in golden-gate-picnic sweet-factory-escape-3d coworking-world sajumadang seongsu-dogam kurashi-otaru; do
    echo "== ios load: $app =="
    xcrun simctl openurl "$DEV" "https://$app.onrender.com/"
    sleep 35
    xcrun simctl io "$DEV" screenshot "results/ios-$app.png" && echo "screenshot saved: ios-$app.png"
  done
  echo "LOAD-ONLY is incomplete iOS verification; failing step honestly"
  exit 1
fi
echo "== ios-check done =="
