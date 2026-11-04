#!/usr/bin/env python3
# Real iOS Simulator Mobile Safari interaction checks.
# Element positions come from the page itself (Web Inspector / CDP Runtime.evaluate);
# taps go through idb (real simulator input pipeline). No synthetic JS clicks.
# A magenta calibration band maps CSS px -> screen points exactly.
import json, subprocess, sys, time, urllib.request
from pathlib import Path

UDID = sys.argv[1]
RES = Path("results"); RES.mkdir(exist_ok=True)
REPORT = []

def rec(app, check, ok, detail=""):
    REPORT.append({"app": app, "check": check, "ok": bool(ok), "detail": str(detail)[:200]})
    print(("PASS" if ok else "FAIL") + f" [{app}] {check}" + (f" :: {detail}" if detail else ""), flush=True)

def sh(*args, timeout=60):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)

def shot(name):
    sh("xcrun", "simctl", "io", UDID, "screenshot", f"results/{name}.png", timeout=60)

# ---- CDP plumbing ----
def find_page(url_part, tries=40):
    for _ in range(tries):
        try:
            with urllib.request.urlopen("http://localhost:9221/json", timeout=3) as r:
                for t in json.load(r):
                    if t.get("type") == "page" and url_part in t.get("url", ""):
                        return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(2)
    return None

class CDP:
    def __init__(self, ws_url):
        import websocket
        self.ws = websocket.create_connection(ws_url, timeout=20)
        self.mid = 0
    def cmd(self, method, params=None):
        self.mid += 1
        self.ws.send(json.dumps({"id": self.mid, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.mid:
                return m.get("result", {})
    def js(self, expr):
        r = self.cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return r.get("result", {}).get("value")

def calibrate(cdp, app):
    """Insert magenta band, screenshot, locate it: returns (scale, top_css_offset) or None."""
    cdp.js("""(()=>{let d=document.getElementById('__cal')||document.createElement('div');
      d.id='__cal';d.style.cssText='position:fixed;top:0;left:0;width:100vw;height:8px;background:#ff00ff;z-index:2147483647;pointer-events:none';
      document.documentElement.appendChild(d);return 1})()""")
    time.sleep(1)
    shot("ios-cal-tmp")
    cdp.js("(()=>{let d=document.getElementById('__cal');if(d)d.remove();return 1})()")
    try:
        from PIL import Image
        im = Image.open("results/ios-cal-tmp.png").convert("RGB")
        w, h = im.size
        iw = cdp.js("window.innerWidth")
        if not iw: return None
        scale = w / iw
        px = im.load()
        for y in range(0, min(h, int(400 * scale))):
            hits = sum(1 for x in range(0, w, 7) if px[x, y][0] > 200 and px[x, y][2] > 200 and px[x, y][1] < 80)
            if hits > (w / 7) * 0.6:
                return scale, y / scale
        return None
    except Exception as e:
        print("calibration error:", e)
        return None

def rect_of(cdp, selector_js):
    return cdp.js(f"""(()=>{{const e={selector_js};if(!e)return null;e.scrollIntoView({{block:'center'}});
      const r=e.getBoundingClientRect();return {{x:r.x,y:r.y,w:r.width,h:r.height}}}})()""")

def tap_el(cdp, cal, selector_js, label):
    r = rect_of(cdp, selector_js)
    if not r:
        return False
    scale, top = cal
    px = r["x"] + r["w"] / 2
    py = top + r["y"] + r["h"] / 2
    res = sh("idb", "ui", "tap", "--udid", UDID, str(round(px, 1)), str(round(py, 1)), timeout=30)
    print(f"  tap {label} at ({px:.0f},{py:.0f}) rc={res.returncode}", flush=True)
    time.sleep(1.2)
    return res.returncode == 0

def type_text(text):
    subprocess.run(["idb", "ui", "text", "--udid", UDID, text], capture_output=True, timeout=30)
    time.sleep(0.8)

def open_app(url):
    sh("xcrun", "simctl", "openurl", UDID, url, timeout=30)

def wait_js(cdp, expr, ms=45000):
    t0 = time.time()
    while (time.time() - t0) * 1000 < ms:
        try:
            if cdp.js(expr):
                return True
        except Exception:
            pass
        time.sleep(1.5)
    return False

# ---- app flows ----
def flow_ggp(cdp, cal):
    A = "golden-gate-picnic"
    rec(A, "boot: __ggp + entry gate", wait_js(cdp, "!!(window.__ggp&&document.getElementById('go'))", 60000))
    gs = cdp.js("JSON.stringify({en:document.querySelector('#langRow button[data-l=en]').classList.contains('on'),ko:document.querySelector('#langRow button[data-l=ko]').classList.contains('on'),goDisabled:document.getElementById('go').disabled,hint:getComputedStyle(document.getElementById('langHint')).display,goText:document.getElementById('go').textContent,cls:document.documentElement.className,emojiCss:[...document.styleSheets].some(x=>(x.href||'').includes('emoji.css'))})") or ""
    shot("ios-ggp-gate-firstvisit")
    rec(A, "gate first visit (no language tap): English preselected, entry enabled", ('"en":true' in gs and '"ko":false' in gs and '"goDisabled":false' in gs and '"hint":"none"' in gs), gs)
    tap_el(cdp, cal, "document.getElementById('nickIn')", "nick field")
    type_text("QA iOS")
    tap_el(cdp, cal, "document.getElementById('go')", "GO")
    ok = wait_js(cdp, "!!(window.__ggp.chars&&window.__ggp.chars.get(window.__ggp.me))", 40000)
    rec(A, "entry via real taps spawns avatar (WS join)", ok)
    if ok:
        seat = cdp.js("(()=>{const s=window.__ggp.seats[4];const c=document.getElementById('cv').getBoundingClientRect();return{x:c.x+s.x*c.width,y:c.y+s.y*c.height}})()")
        if seat:
            scale, top = cal
            sh("idb", "ui", "tap", "--udid", UDID, str(round(seat["x"],1)), str(round(top+seat["y"],1)), timeout=30)
            time.sleep(3)
            rec(A, "canvas tap claims seat (hit-test + WS)", bool(cdp.js("(()=>{const s=window.__ggp.seats[4];return!!(s&&s.by===window.__ggp.me)})()")))
    try:
        sky = cdp.js("document.getElementById('skyinfo')?document.getElementById('skyinfo').textContent:''") or ""
        nxt = cdp.js("document.getElementById('rest')?document.getElementById('rest').textContent:''") or ""
        rec(A, "sky info pill shows SF sun+moon times", ("SF" in sky and "\U0001F305" in sky and "\U0001F319" in sky), sky.replace("\n"," | "))
        rec(A, "Next pill labels its time zone (SF or local)", ("Next" in nxt and (" SF" in nxt or " local" in nxt)), nxt)
    except Exception as e:
        rec(A, "sky/next pill read", False, str(e)[:150])
    shot("ios-golden-gate-picnic")

def flow_sweet(cdp, cal):
    A = "sweet-factory-escape-3d"
    rec(A, "boot: intro + start button", wait_js(cdp, "!!document.getElementById('startBtn')", 60000))
    tap_el(cdp, cal, "document.getElementById('in1')", "nick")
    type_text("QA")
    tap_el(cdp, cal, "document.getElementById('startBtn')", "start")
    rec(A, "entry via real taps boots 3D game (__qa)", wait_js(cdp, "!!window.__qa", 40000))
    shot("ios-sweet-factory-escape-3d")

def flow_coworking(cdp, cal):
    A = "coworking-world"
    rec(A, "boot: entry panel", wait_js(cdp, "!!document.getElementById('enter')", 60000))
    tap_el(cdp, cal, "document.getElementById('nick')", "nick")
    type_text("QA")
    tap_el(cdp, cal, "document.getElementById('enter')", "enter")
    rec(A, "entry via real taps joins world (WS)", wait_js(cdp, "(()=>{try{return!!(window.__me&&window.__me())}catch(e){return false}})()", 40000))
    shot("ios-coworking-world")

def flow_dalbit(cdp, cal):
    A = "sajumadang"
    rec(A, "boot: title + UI", wait_js(cdp, "document.title&&document.title.indexOf('사주마당')>=0&&!!document.querySelector('button')", 60000))
    rec(A, "extras22.js executes (seasonfx)", wait_js(cdp, "!!document.querySelector('.seasonfx')", 15000))
    tap_el(cdp, cal, "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('닫기'))", "dismiss guide")
    time.sleep(1)
    tap_el(cdp, cal, "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('이름 짓고 들어가기'))", "open nick sheet")
    time.sleep(1)
    tap_el(cdp, cal, "document.getElementById('fNick')", "nick field")
    type_text("QA")
    tap_el(cdp, cal, "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('이 모습으로 들어가기'))", "submit nick")
    time.sleep(2)
    rec(A, "first-visit nickname flow via taps", cdp.js("!!document.getElementById('sayInput')"))
    tap_el(cdp, cal, "document.getElementById('sceneBtn')", "gate->maru")
    in_maru = wait_js(cdp, "document.getElementById('stage').classList.contains('scene-maru')", 25000)
    rec(A, "gate->maru entry via real tap", in_maru)
    if in_maru:
        ph = cdp.js("(document.getElementById('sayInput')||{}).placeholder||''")
        rec(A, "placeholder switches to 마루", bool(ph and "마루" in ph), ph)
    shot("ios-" + A)

def flow_dogam(cdp, cal, app, expect_nodes):
    A = app
    rec(A, "boot: language/start screen", wait_js(cdp, "!!(document.querySelector('.language-grid')||document.querySelector('.start'))", 60000))
    tap_el(cdp, cal, "[...document.querySelectorAll('.language-grid button')].find(b=>/English/.test(b.textContent))", "English")
    tap_el(cdp, cal, "document.getElementById('name')", "name")
    type_text("QA")
    tap_el(cdp, cal, "document.querySelector('#start-actions button')", "begin")
    city = wait_js(cdp, "window.__dogam&&window.__dogam.stage()==='city'", 20000)
    if city:
        tap_el(cdp, cal, "document.querySelector('#city-action button')", "begin-city")
    stage = wait_js(cdp, "window.__dogam&&window.__dogam.stage()==='game'", 30000)
    rec(A, "entry via real taps reaches world", stage, stage and cdp.js("window.__dogam&&window.__dogam.stage()"))
    n = cdp.js("window.GAME_DATA?window.GAME_DATA.nodes.length:0")
    rec(A, "node count", n == expect_nodes, f"nodes={n}")
    if app == "seongsu-dogam":
        places = cdp.js("window.GAME_DATA.nodes.filter(n=>/베통|무구옥|원밀리언|올리브영|무신사/.test(n.name[0])).map(n=>n.name[0]).join(' | ')")
        rec(A, "new places present: Betong+Muguok+1MILLION+OliveYoung+Musinsa", bool(places and all(x in places for x in ["베통","무구옥","원밀리언","올리브영","무신사"])), places)
    shot(f"ios-{app}")
    # real tap on canvas to walk
    tap_el(cdp, cal, "document.querySelector('canvas')", "canvas walk")
    time.sleep(2)
    shot(f"ios-{app}-tap")


def tap_xy(cdp, cal, cssx, cssy, label):
    scale, top = cal
    res = sh("idb", "ui", "tap", "--udid", UDID, str(round(cssx, 1)), str(round(top + cssy, 1)), timeout=30)
    print(f"  tapxy {label} at ({cssx:.0f},{cssy:.0f}) rc={res.returncode}", flush=True)
    time.sleep(0.6)
    return res.returncode == 0

def flow_seongsu_opt(cdp, cal):
    A = "seongsu-dogam"
    LANGS = [("한국어", "ko"), ("日本語", "ja"), ("中文", "zh"), ("English", "en")]
    rec(A, "boot: language screen", wait_js(cdp, "!!document.querySelector('.language-grid')", 60000))
    seen = {}
    for i, (lab, code) in enumerate(LANGS):
        if not cdp.js("!!document.querySelector('.language-grid')"):
            tap_el(cdp, cal, "[...document.querySelectorAll('#start-actions button')].pop()", "Language button")
            wait_js(cdp, "!!document.querySelector('.language-grid')", 8000)
        shot(f"ios-seongsu-lang-grid-{i}")
        tap_el(cdp, cal, f"document.querySelectorAll('.language-grid button')[{i}]", lab)
        wait_js(cdp, "!!document.querySelector('.travelers')", 10000)
        time.sleep(1.5)
        h1 = cdp.js("document.documentElement.lang+' | '+document.querySelector('#app h1').innerText")
        fam = cdp.js("getComputedStyle(document.body).fontFamily.slice(0,60)")
        loaded = cdp.js("[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight).slice(0,6).join(',')")
        seen[code] = h1
        rec(A, f"language {code}: start screen text + fonts", bool(h1 and h1.startswith(code)), f"{h1} | font={fam} | loadedFonts={loaded}")
        shot(f"ios-seongsu-lang-{code}")
    rec(A, "four languages yield distinct start-screen text", len(set(seen.values())) == 4, "; ".join(seen.values()))
    # settle on English, avatar pixels (10 base avatars): first-load fallback may show, then eventual sprites
    time.sleep(6)
    shot("ios-seongsu-avatars-grid-8s")
    n_av = cdp.js("document.querySelectorAll('.travelers button').length")
    rec(A, "10 base avatars listed", n_av == 10, f"count={n_av}")
    for idx in (0, 4, 9):
        tap_el(cdp, cal, f"document.querySelectorAll('.travelers button')[{idx}]", f"avatar {idx}")
        time.sleep(1.5)
        shot(f"ios-seongsu-avatar-{idx}")
    tap_el(cdp, cal, "document.getElementById('name')", "name")
    type_text("QA")
    tap_el(cdp, cal, "document.querySelector('#start-actions button')", "begin")
    city = wait_js(cdp, "window.__dogam&&window.__dogam.stage()==='city'", 20000)
    if city:
        tap_el(cdp, cal, "document.querySelector('#city-action button')", "begin-city")
    stage = wait_js(cdp, "window.__dogam&&window.__dogam.stage()==='game'", 30000)
    rec(A, "entry via real taps reaches world", stage)
    time.sleep(0.7); shot("ios-seongsu-entry-0p7s")
    time.sleep(7); shot("ios-seongsu-entry-8s")
    r = cdp.js("(()=>{const c=document.querySelector('canvas');const b=c.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}})()")
    p0 = cdp.js("JSON.stringify(window.__dogam.pos())")
    if r:
        tap_xy(cdp, cal, r["x"] + r["w"] * 0.8, r["y"] + r["h"] * 0.6, "walk right-down")
        shot("ios-seongsu-walk-a"); time.sleep(0.7); shot("ios-seongsu-walk-b"); time.sleep(1.5); shot("ios-seongsu-walk-c")
    p1 = cdp.js("JSON.stringify(window.__dogam.pos())")
    rec(A, "avatar walks after real canvas tap (position changes; direction frames visible in walk-a/b/c shots)", bool(p0 and p1 and p0 != p1), f"{p0} -> {p1}")
    links = json.loads(cdp.js("JSON.stringify(Object.fromEntries(window.GAME_DATA.nodes.map(n=>[n.id,n.links])))") or "{}")
    def bfs(a, b):
        q = [[a]]
        while q:
            pth = q.pop(0)
            if pth[-1] == b: return pth
            for l in links.get(str(pth[-1]), []):
                if l not in pth: q.append(pth + [l])
        return None
    cur = cdp.js("window.__dogam.S().scene")
    for target in (17, 19, 21, 23, 26):
        pth = bfs(cur, target); ok = bool(pth)
        for i in range((len(pth) - 1) if pth else 0):
            idx = links[str(pth[i])].index(pth[i + 1])
            for attempt in range(2):
                wait_js(cdp, "(()=>{const a=JSON.stringify(window.__dogam.pos());window.__p2=window.__p1;window.__p1=a;return window.__p1===window.__p2})()", 12000)
                tap_el(cdp, cal, f"document.querySelectorAll('.gate-links button')[{idx}]", f"gate {pth[i]}->{pth[i+1]}")
                if wait_js(cdp, f"window.__dogam.S().scene==={pth[i+1]}", 25000): break
            else:
                ok = False; break
        cur = cdp.js("window.__dogam.S().scene")
        time.sleep(1.0); shot(f"ios-seongsu-node{target}-1s")
        time.sleep(6.0); shot(f"ios-seongsu-node{target}-7s")
        rec(A, f"new node {target} entered via real gate taps (lazy background; compare 1s vs 7s shots for fallback->real)", ok and cur == target, f"scene={cur}")
    st = cdp.js("localStorage.getItem(window.GAME_DATA.tag+'-atlas-v1')")
    cdp.js("setTimeout(()=>location.reload(),50);1")
    time.sleep(8)
    ws = find_page("seongsu-dogam")
    try:
        c2 = CDP(ws) if ws else cdp
        back = wait_js(c2, "!!document.querySelector('#app')&&document.querySelector('#app').innerText.length>5", 30000)
        info = c2.js("JSON.stringify({stage:window.__dogam&&window.__dogam.stage(),scene:window.__dogam&&window.__dogam.S&&window.__dogam.S().scene,ls:(localStorage.getItem(window.GAME_DATA.tag+'-atlas-v1')||'').slice(0,80)})")
        shot("ios-seongsu-after-reload")
        rec(A, "reload keeps saved state (see after-reload shot)", bool(back and info and '"scene"' in info), f"before={str(st)[:60]} after={info}")
    except Exception as e:
        rec(A, "reload keeps saved state", False, str(e)[:150])

def main():
    apps = [
        ("https://golden-gate-picnic-sf.onrender.com/", "golden-gate-picnic", flow_ggp),
        ("https://sweet-factory-escape-3d.onrender.com/", "sweet-factory-escape-3d", flow_sweet),
        ("https://coworking-world.onrender.com/", "coworking-world", flow_coworking),
        ("https://sajumadang.onrender.com/", "sajumadang", flow_dalbit),
        ("https://seongsu-dogam.onrender.com/", "seongsu-dogam", lambda c, k: flow_seongsu_opt(c, k)),
        ("https://kurashi-otaru.onrender.com/", "kurashi-otaru", lambda c, k: flow_dogam(c, k, "kurashi-otaru", 32)),
    ]
    import os
    only = [x for x in os.environ.get('ONLY','').split(',') if x]
    if only: apps = [a for a in apps if any(o in a[1] for o in only)]
    for url, name, fn in apps:
        open_app(url)
        time.sleep(8)
        ws = find_page(name)
        if not ws:
            rec(name, "web inspector attach", False, "no CDP target; load-only screenshot")
            time.sleep(20)
            shot(f"ios-{name}")
            continue
        try:
            cdp = CDP(ws)
            cal = calibrate(cdp, name)
            if not cal:
                rec(name, "viewport calibration", False, "falling back to load-only screenshot")
                time.sleep(15)
                shot(f"ios-{name}")
                continue
            rec(name, "viewport calibration", True, f"scale={cal[0]:.1f} top={cal[1]:.0f}")
            fn(cdp, cal)
            cdp.ws.close()
        except Exception as e:
            rec(name, "interaction run", False, str(e)[:200])
            shot(f"ios-{name}")
    json.dump(REPORT, open("results/ios-summary.json", "w"), indent=1)
    fails = sum(1 for r in REPORT if not r["ok"])
    print(f"\n==== iOS SIMULATOR SAFARI: {len(REPORT)-fails}/{len(REPORT)} checks passed ====")
    sys.exit(1 if fails else 0)

main()
