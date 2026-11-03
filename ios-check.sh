#!/bin/bash
# iOS Simulator Mobile Safari verification: booted simulator + real Safari app,
# real taps via idb, element positions via Web Inspector (IWDP) + pixel calibration.
set -u
# global watchdog: end this script before the job timeout so the results upload step still runs
( exec >/dev/null 2>&1; sleep 1680; echo "GLOBAL WATCHDOG: ios-check exceeded 28 min, aborting"; pkill -P $$ 2>/dev/null; kill -9 $$ 2>/dev/null ) &
WD_PID=$!; trap 'kill $WD_PID 2>/dev/null' EXIT
# watchdog: run command with hard timeout (idb/brew can block indefinitely)
run_to() { local secs=$1; shift; "$@" & local pid=$!; local i=0
  while kill -0 $pid 2>/dev/null; do sleep 2; i=$((i+2))
    if [ $i -ge $secs ]; then kill -9 $pid 2>/dev/null; wait $pid 2>/dev/null; return 124; fi
  done; wait $pid; }
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
run_to 300 xcrun simctl bootstatus "$DEV" -b || echo "bootstatus timeout/fail rc=$?"
open -a Simulator --args -CurrentDeviceUDID "$DEV" 2>/dev/null || true
sleep 5

INTERACT_OK=0
echo "== xcode diagnostics =="; xcode-select -p; ls -d /Applications/Xcode* 2>/dev/null; xcodebuild -version 2>&1 | head -2
NEWX=$(ls -d /Applications/Xcode_26*.app 2>/dev/null | sort -V | tail -1)
if [ -n "$NEWX" ]; then echo "selecting $NEWX for idb-companion build"; sudo xcode-select -s "$NEWX/Contents/Developer"; fi
# ---- Route A: Appium XCUITest (W3C WebDriver) on the booted simulator, reusing safari-check.mjs in mobile mode ----
echo "== Appium XCUITest route =="
SIM_INFO=$(xcrun simctl list devices -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
for k,v in d.items():
    for x in v:
        if x["udid"]=="'"$DEV"'": print(k.split("SimRuntime.")[-1].replace("iOS-","").replace("-","."), x["name"])
')
export SIM_UDID="$DEV" SIM_OS="${SIM_INFO%% *}" SIM_NAME="${SIM_INFO#* }"
echo "sim: $SIM_UDID os=$SIM_OS name=$SIM_NAME"
# selecting a different Xcode restarts CoreSimulator: Appium run 43 found the device "not running"; boot it again
xcrun simctl boot "$DEV" 2>&1 | head -2 || true
run_to 300 xcrun simctl bootstatus "$DEV" -b >/dev/null 2>&1; echo "sim state: $(xcrun simctl list devices | grep "$DEV" | head -1)"
open -a Simulator --args -CurrentDeviceUDID "$DEV" 2>/dev/null || true; sleep 5
if run_to 300 npm i -g appium >/tmp/ap-npm.log 2>&1 && run_to 300 appium driver install xcuitest >/tmp/ap-drv.log 2>&1; then
  tail -2 /tmp/ap-drv.log
  (appium --log-no-colors --port 4723 >/tmp/appium.log 2>&1 &) ; sleep 8
  APDIR=$(pwd)/appium-work; mkdir -p "$APDIR"; SRC=$(pwd)
  ( set -o pipefail; cd "$APDIR" && AP=1 ONLY="${ONLY:-seongsu-dogam,sajumadang,kurashi-otaru}" run_to 1200 node "$SRC/safari-check.mjs" 2>&1 | tee "$SRC/results/ios-appium.log" ); AP_RC=${PIPESTATUS[0]}
  cp -R "$APDIR/results" results/appium-ios 2>/dev/null || true
  echo "---- appium server log tail ----"; tail -25 /tmp/appium.log | cut -c1-240
  cp /tmp/appium.log results/appium-server.log 2>/dev/null || true
  echo "== appium route done rc=${AP_RC:-?} =="
  exit "${AP_RC:-1}"
else
  echo "appium install failed:"; tail -5 /tmp/ap-npm.log /tmp/ap-drv.log 2>/dev/null
  exit 1
fi

echo "== installing interaction tooling (idb + ios-webkit-debug-proxy) =="
if run_to 600 brew install ios-webkit-debug-proxy >/tmp/ios-brew.log 2>&1 && { run_to 300 brew tap facebook/fb >>/tmp/ios-brew.log 2>&1; run_to 60 brew trust facebook/fb >>/tmp/ios-brew.log 2>&1; run_to 900 brew install idb-companion >>/tmp/ios-brew.log 2>&1; } || { command -v idb_companion >/dev/null && command -v ios_webkit_debug_proxy >/dev/null; }; then
  # fb-idb breaks on the runner's newest default python (3.15 traceback in idb/cli/main.py); use 3.12
  PYI=python3
  if run_to 600 brew install python@3.12 >>/tmp/ios-brew.log 2>&1; then PYI="$(brew --prefix python@3.12)/bin/python3.12"; fi
  echo "idb venv python: $($PYI --version 2>&1)"
  if $PYI -m venv /tmp/idbenv && /tmp/idbenv/bin/pip install --quiet fb-idb websocket-client pillow >>/tmp/ios-pip.log 2>&1; then
    export PATH="/tmp/idbenv/bin:$PATH"
    # idb looks for the companion at /usr/local/bin (Intel path); brew on arm64 installs under /opt/homebrew
    IDBC="$(command -v idb_companion || true)"; echo "idb_companion at: ${IDBC:-MISSING}"
    if [ -n "$IDBC" ] && [ ! -e /usr/local/bin/idb_companion ]; then sudo mkdir -p /usr/local/bin && sudo ln -sf "$IDBC" /usr/local/bin/idb_companion; fi
    echo "idb paths: $(command -v idb) / $(command -v idb_companion)"
    run_to 25 idb list-targets 2>&1 | head -5; LT_RC=$?
    [ "${LT_RC:-0}" = "124" ] && echo "idb list-targets TIMED OUT (companion connect hang)"
    if command -v idb >/dev/null && run_to 25 idb list-targets 2>/dev/null | grep -qi "$DEV"; then
      ios_webkit_debug_proxy -c "$DEV:9221" >/tmp/iwdp.log 2>&1 &
      IWDP_PID=$!
      sleep 4
      INTERACT_OK=1
    else
      echo "idb not functional; falling back to load+screenshot only"
      run_to 25 idb list-targets 2>&1 | tail -15
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
  /tmp/idbenv/bin/python ios-interact.py "$DEV" 2>&1; IOS_RC=$?
  kill $IWDP_PID 2>/dev/null || true
  [ "${IOS_RC:-1}" = "0" ] || exit 1
else
  echo "== LOAD-ONLY fallback (interaction tooling unavailable) =="
  run_to 30 xcrun simctl list devices booted 2>&1 | head -5
  for app in golden-gate-picnic sweet-factory-escape-3d coworking-world sajumadang seongsu-dogam kurashi-otaru; do
    echo "== ios load: $app =="
    run_to 60 xcrun simctl openurl "$DEV" "https://$app.onrender.com/" || echo "openurl timeout/fail rc=$?"
    sleep 35
    run_to 60 xcrun simctl io "$DEV" screenshot "results/ios-$app.png" && echo "screenshot saved: ios-$app.png" || echo "screenshot timeout/fail"
  done
  echo "LOAD-ONLY is incomplete iOS verification; failing step honestly"
  exit 1
fi
echo "== ios-check done =="
