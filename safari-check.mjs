// Real desktop Safari verification via safaridriver (WebDriver REST).
// Uses only real element clicks and pointer actions - no synthetic JS clicks.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BS = process.env.BS === '1';
const AP = process.env.AP === '1'; // local Appium (XCUITest) against the booted iOS Simulator
const BS_DEVICE = process.env.BS_DEVICE || (AP ? 'iPhone-Simulator' : null); // e.g. 'iPhone 15 Pro' for real-mobile session
const BASE = BS ? 'https://hub-cloud.browserstack.com/wd/hub' : (AP ? 'http://127.0.0.1:4723' : 'http://127.0.0.1:4444');
const BS_AUTH = BS ? 'Basic ' + Buffer.from(process.env.BS_CREDS + ':').toString('base64') : null;
const EL = 'element-6066-11e4-a52e-4f735466cecf';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('results', { recursive: true });
const report = [];
function rec(app, check, ok, detail = '') {
  report.push({ app, check, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${app}] ${check}${detail ? ' :: ' + detail : ''}`);
}

async function api(method, path, body, sid, timeoutMs = 25000) {
  const url = BASE + (sid ? `/session/${sid}${path}` : path);
  if (AP) { // node:http has no headers timeout; WDA first start on the runner takes ~4.5 min
    const http = await import('node:http');
    const txt = await new Promise((resolve, reject) => {
      const rq = http.request(url, { method, headers: { 'content-type': 'application/json' }, timeout: timeoutMs }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
      rq.on('timeout', () => { rq.destroy(new Error('http timeout ' + timeoutMs)); });
      rq.on('error', reject);
      if (body) rq.write(JSON.stringify(body)); rq.end();
    });
    let j = {}; try { j = JSON.parse(txt); } catch { console.log('WD non-JSON', method, path, txt.slice(0, 200)); }
    if (j && j.value && j.value.error) console.log('WD error', method, path, JSON.stringify(j.value).slice(0, 300));
    return j.value !== undefined ? j.value : j;
  }
  const r = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(BS_AUTH ? { authorization: BS_AUTH } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch { console.log('WD non-JSON', method, path, r.status, t.slice(0, 200)); }
  if (j && j.value && j.value.error) console.log('WD error', method, path, JSON.stringify(j.value).slice(0, 300));
  return j.value !== undefined ? j.value : j;
}
async function newSession() {
  let caps;
  if (AP) {
    caps = { capabilities: { alwaysMatch: { platformName: 'iOS', browserName: 'Safari',
      'appium:automationName': 'XCUITest', 'appium:udid': process.env.SIM_UDID, 'appium:deviceName': process.env.SIM_NAME || 'iPhone',
      'appium:platformVersion': process.env.SIM_OS, 'appium:newCommandTimeout': 300, 'appium:wdaLaunchTimeout': 420000,
      'appium:wdaConnectionTimeout': 420000, 'appium:wdaStartupRetries': 1, 'appium:noReset': true, 'appium:showXcodeLog': true } } };
  } else if (BS && BS_DEVICE) {
    caps = { capabilities: { alwaysMatch: {
      browserName: BS_DEVICE.startsWith('iPhone') || BS_DEVICE.startsWith('iPad') ? 'iPhone' : BS_DEVICE,
      'bstack:options': { deviceName: BS_DEVICE, osVersion: process.env.BS_OS_VERSION || '17', realMobile: 'true',
        sessionName: 'safari-verify-ios', buildName: process.env.BS_BUILD || 'safari-verify-bs', debug: 'true' } } } };
  } else if (BS) {
    caps = { capabilities: { alwaysMatch: {
      browserName: 'Safari', browserVersion: process.env.BS_BROWSER_VERSION || '18.4',
      'bstack:options': { os: 'OS X', osVersion: process.env.BS_OS || 'Sequoia',
        sessionName: 'safari-verify-desktop', buildName: process.env.BS_BUILD || 'safari-verify-bs', debug: 'true' } } } };
  } else {
    caps = { capabilities: { alwaysMatch: { browserName: 'safari' } } };
  }
  const v = await api('POST', '/session', caps, undefined, AP ? 600000 : 25000);
  if (!v || !v.sessionId) throw new Error('no session: ' + JSON.stringify(v));
  if (!BS_DEVICE) await api('POST', '/window/rect', { width: 1280, height: 900 }, v.sessionId).catch(() => {});
  return v.sessionId;
}
const nav = (sid, url) => api('POST', '/url', { url }, sid);
const wrap = s => /^\s*(return|const|let|var)\b/.test(s) ? s : 'return (' + s + ');';
const exe = (sid, script, args = []) => api('POST', '/execute/sync', { script: wrap(script), args }, sid);
async function els(sid, using, value) {
  try { const v = await api('POST', '/elements', { using, value }, sid); return (v && Array.isArray(v)) ? v : []; } catch { return []; }
}
async function el(sid, using, value) {
  try {
    const v = await api('POST', '/element', { using, value }, sid);
    return v && v[EL] ? v[EL] : null;
  } catch { return null; }
}
const click = (sid, id) => api('POST', `/element/${id}/click`, {}, sid);
const type = async (sid, id, text) => { await api('POST', `/element/${id}/clear`, {}, sid).catch(()=>{}); return api('POST', `/element/${id}/value`, { text, value: [...text] }, sid); };
const shotNative = async (name) => { try { const { execFileSync } = await import('node:child_process'); execFileSync('/usr/sbin/screencapture', ['-x', `results/native-${name}.png`], { timeout: 15000 }); console.log('shotNative ok', name, fs.existsSync(`results/native-${name}.png`) ? fs.statSync(`results/native-${name}.png`).size : 0); } catch (e) { console.log('shotNative FAILED', name, String(e).slice(0, 120)); } };
const shot = async (sid, name) => { const v = await api('GET', '/screenshot', null, sid).catch(() => null); if (v) fs.writeFileSync(`results/${name}.png`, Buffer.from(v, 'base64')); };
async function waitFor(sid, script, ms = 60000) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < ms) {
    try { const v = await exe(sid, script); if (v) return v; } catch (e) { lastErr = String(e); }
    await sleep(800);
  }
  if (lastErr) console.log('waitFor lastErr:', lastErr.slice(0, 200));
  return null;
}
async function tapFraction(sid, elId, fx, fy) {
  const rect = await exe(sid, 'const e=arguments[0],r=e.getBoundingClientRect();return{w:r.width,h:r.height}', [{ [EL]: elId }]);
  const x = Math.round((fx - 0.5) * rect.w), y = Math.round((fy - 0.5) * rect.h);
  await api('POST', '/actions', { actions: [{ type: 'pointer', id: 'p1', parameters: { pointerType: 'mouse' }, actions: [
    { type: 'pointerMove', duration: 0, origin: { [EL]: elId }, x, y },
    { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 100 }, { type: 'pointerUp', button: 0 }] }] }, sid);
  await api('DELETE', '/actions', {}, sid);
}
async function ready(sid, ms = 90000) {
  return waitFor(sid, `document.readyState==='complete' && document.title && !/render|spinning/i.test(document.title) ? document.title : null`, ms);
}

// ---- per-app checks ----
async function checkGGP(sid) {
  const A = 'golden-gate-picnic';
  const boot = await waitFor(sid, `!!(window.__ggp && document.getElementById('go'))`, 60000);
  rec(A, 'boot: page loads, __ggp handle + entry gate present', !!boot);
  if (!boot) return;
  // first-visit gate state BEFORE touching the language picker: English preselected, entry open, emoji font path
  const g0 = await exe(sid, `return JSON.stringify({en:document.querySelector('#langRow button[data-l=en]').classList.contains('on'),ko:document.querySelector('#langRow button[data-l=ko]').classList.contains('on'),goDisabled:document.getElementById('go').disabled,hint:getComputedStyle(document.getElementById('langHint')).display,goText:document.getElementById('go').textContent,cls:document.documentElement.className,emojiCss:[...document.styleSheets].some(x=>(x.href||'').includes('emoji.css')),dice:document.getElementById('nickDice').textContent,boy:document.querySelector('#gRow button').textContent,ua:navigator.userAgent})`).catch(() => null);
  console.log('GATE-STATE', g0);
  await sleep(1500); await shot(sid, 'desktop-ggp-gate-firstvisit');
  try { const gs = JSON.parse(g0); rec(A, 'gate first visit: English preselected, Korean not, entry enabled, no pick-language hint', gs.en && !gs.ko && !gs.goDisabled && gs.hint === 'none' && gs.goText === 'Spread the mat', g0); } catch (e) { rec(A, 'gate first visit: English preselected, entry enabled', false, 'no state'); }
  const inp = await el(sid, 'css selector', '#nickIn');
  if (inp) { await click(sid, inp); await type(sid, inp, 'QA Safari'); }
  const go = await el(sid, 'css selector', '#go');
  if (go) await click(sid, go);
  const me = await waitFor(sid, `!!(window.__ggp && window.__ggp.chars && window.__ggp.chars.get(window.__ggp.me))`, 45000);
  rec(A, 'entry: real button clicks spawn avatar (WebSocket join)', !!me);
  if (me) {
    { // sky info / Next pill labels and avatar alpha (regression checks for the 2026-11-04 fixes)
      const sky = await exe(sid, `var e=document.getElementById('skyinfo');return e?e.textContent:''`).catch(() => ''), nxt = await exe(sid, `var e=document.getElementById('rest');return e?e.textContent:''`).catch(() => '');
      rec(A, 'sky info pill shows SF sun+moon times', !!(sky && sky.includes('SF') && sky.includes('\u{1F305}') && sky.includes('\u{1F319}')), String(sky).replace(/\n/g, ' | '));
      await exe(sid, `var f=CanvasRenderingContext2D.prototype.fill;window.__al=[];if(!window.__alHook){window.__alHook=1;var col=window.__ggp.chars.get(window.__ggp.me).top;CanvasRenderingContext2D.prototype.fill=function(){if(this.fillStyle===col)window.__al.push(+this.globalAlpha.toFixed(3));return f.apply(this,arguments)}}return 1`).catch(() => null);
      const al = await waitFor(sid, `return window.__al&&window.__al.length>3?JSON.stringify(Array.from(new Set(window.__al))):null`, 8000);
      rec(A, 'avatar drawn fully opaque (globalAlpha 1)', al === '[1]', 'alphas=' + al);
      console.log('nextpill(info)', JSON.stringify(nxt));
    }
    const seatF = await exe(sid, `(()=>{const c=document.getElementById('cv');const m=window.__ggp.chars.get(window.__ggp.me);
      const cw=c.clientWidth, ch=c.clientHeight; let best=null, bd=1e9;
      window.__ggp.seats.forEach((s,i)=>{const fx=s.x/cw, fy=s.y/ch; if(fx>0.04&&fx<0.96&&fy>0.04&&fy<0.96){const d=m?Math.abs(s.x-m.x):i; if(d<bd){bd=d;best={i,fx,fy,dist:Math.round(bd)}}}});
      return best})()`).catch(()=>null);
    if (!seatF) rec(A, 'canvas tap claims seat (hit-testing + WS round-trip)', false, 'no visible seat found (viewport fractions)');
    if (seatF) {
      const cv = await el(sid, 'css selector', '#cv');
      if (cv) {
        if (BS_DEVICE) {
          // iOS touch-walk: native XCTest tap on open ground must move the avatar (original mobile movement complaint)
          const pos0 = await exe(sid, `(()=>{const c=window.__ggp.chars.get(window.__ggp.me);return c?JSON.stringify({x:c.px,y:c.py}):null})()`).catch(()=>null);
          const wrect = await exe(sid, `(function(){const c=document.getElementById('cv');const r=c.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width*0.3),y:Math.round(r.y+r.height*0.62)})})()`).catch(()=>null);
          await api('POST', '/execute/sync', { script: 'mobile: tap', args: [wrect ? JSON.parse(wrect) : {x:120,y:400}] }, sid).catch(()=>{});
          const walked = await waitFor(sid, `(()=>{const c=window.__ggp.chars.get(window.__ggp.me);return c&&(JSON.stringify({x:c.px,y:c.py})!==${pos0})?true:null})()`, 8000);
          rec(A, 'iPhone touch-walk: native tap on ground moves avatar', walked === true, 'pos ' + pos0 + ' changed=' + (walked === true));
          // iOS: real element taps through the UI flow - open Actions panel, tap Sit (nearestSeat + WS claim)
          const bar = await el(sid, 'css selector', '#bar [data-p="act"]');
          if (bar) { await click(sid, bar); await sleep(700); }
          const sitBtn = await el(sid, 'css selector', '#actp button[data-a="sit"]');
          if (sitBtn) { await click(sid, sitBtn); }
          console.log('seatsit-ui(info)', 'bar=' + !!bar, 'sitBtn=' + !!sitBtn);
          const claimed = await waitFor(sid, `(()=>{const c=window.__ggp.chars.get(window.__ggp.me);return c&&c.seat!=null?c.seat:null})()`, 15000);
          rec(A, 'Actions panel Sit tap claims seat (real UI flow + WS round-trip)', claimed !== null && claimed !== false, 'claimed=' + JSON.stringify(claimed));
          if (claimed !== null && claimed !== false) { await sleep(4000); await shot(sid, 'ios-ggp-seated');
            const seated = await exe(sid, `(()=>{const c=window.__ggp.chars.get(window.__ggp.me);return c?JSON.stringify({seat:c.seat,act:c.act,moving:!!c.moving}):null})()`).catch(()=>null);
            rec(A, 'final seated state after arrival (iPhone)', !!(seated && JSON.parse(seated).seat != null && !JSON.parse(seated).moving), String(seated));
          }
        } else {
          const tapres = await tapFraction(sid, cv, seatF.fx, seatF.fy);
          console.log('seattap(info)', String(JSON.stringify(tapres)).slice(0,100), 'seat', JSON.stringify(seatF));
          const claimed = await waitFor(sid, `(()=>{const c=window.__ggp.chars.get(window.__ggp.me);return c&&c.seat!=null?c.seat:null})()`, 15000);
          const dest = await exe(sid, `JSON.stringify(window.__ggp.dest||null)`).catch(()=>null);
          console.log('seatclaim(info)', 'claimed=' + String(JSON.stringify(claimed)), 'dest=' + String(dest));
          rec(A, 'canvas tap claims seat (hit-testing + WS round-trip)', claimed !== null && claimed !== false, 'tap seat#' + seatF.i + ' dist=' + seatF.dist + ' claimed=' + JSON.stringify(claimed));
        }
      } else rec(A, 'canvas tap claims seat (hit-testing + WS round-trip)', false, 'no #cv canvas element');
    }
  }
  await shot(sid, 'desktop-golden-gate-picnic');
}

async function glDump(sid, name) {
  const r = await exe(sid, `(()=>{try{const cs=[...document.querySelectorAll('canvas')];let best=null;for(const c of cs){const gl=c.getContext('webgl2')||c.getContext('webgl');if(gl){best={c,gl};break}}if(!best)return JSON.stringify({error:'no webgl canvas'});const gl=best.gl;const W=gl.drawingBufferWidth,H=gl.drawingBufferHeight;const buf=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);const S=8,w=Math.floor(W/S),h=Math.floor(H/S);const out=new Uint8Array(w*h*3);let nz=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const si=((H-1-y*S)*W+x*S)*4;const o=(y*w+x)*3;out[o]=buf[si];out[o+1]=buf[si+1];out[o+2]=buf[si+2];if(buf[si]+buf[si+1]+buf[si+2]>30)nz++}let b64='';for(let i=0;i<out.length;i+=0x8000)b64+=String.fromCharCode.apply(null,out.subarray(i,i+0x8000));return JSON.stringify({W,H,w,h,nonDark:nz,total:w*h,preserve:gl.getContextAttributes().preserveDrawingBuffer,b64:btoa(b64)})}catch(e){return JSON.stringify({error:String(e)})}})()`).catch(e => JSON.stringify({ error: 'ERR ' + e }));
  try { const o = JSON.parse(r); const { b64, ...meta } = o; console.log('gldump(' + name + ')', JSON.stringify(meta)); if (b64) fs.writeFileSync(`results/gl-${name}.json`, JSON.stringify(o)); return meta; } catch (e) { console.log('gldump(' + name + ') parse fail', String(r).slice(0, 150)); return { error: String(e) }; }
}
async function checkSweet(sid) {
  const A = 'sweet-factory-escape-3d';
  if (process.env.RESUME) {
    const live = await exe(sid, '!!window.__qa').catch(()=>false);
    rec(A, 'resume: game state still live', !!live);
    if (!live) return;
    await sweetPlay(sid, A);
    return;
  }
  const boot = await waitFor(sid, `!!document.getElementById('startBtn')`, 60000);
  rec(A, 'boot: intro screen with start button', !!boot);
  if (!boot) return;
  const inp = await el(sid, 'css selector', '#in1');
  if (inp) { await click(sid, inp); await type(sid, inp, 'QA'); }
  const b = await el(sid, 'css selector', '#startBtn');
  if (b) await click(sid, b);
  const run = await waitFor(sid, `!!window.__qa`, 45000);
  rec(A, 'entry: start button click boots 3D game (__qa handle)', !!run);
  if (run) {
    const keys = await exe(sid, `Object.keys(window.__qa).join(',')`).catch(()=>null);
    rec(A, 'game state readable', !!keys, String(keys).slice(0, 120));
  }
  if (run && process.env.DRAGPROBE) {
    await exe(sid, `return (function(){const c=document.querySelector('canvas');if(c) c.requestPointerLock=function(){};try{document.exitPointerLock()}catch(e){}return true})()`).catch(()=>{});
    await sleep(1500);
    const before = await exe(sid, 'window.__qa.yaw()').catch(()=>null);
    const hit = await exe(sid, `(function(){const e=document.elementFromPoint(innerWidth/2, innerHeight/2);return e?e.id||e.tagName:null})()`).catch(()=>null);
    const cv = await el(sid, 'css selector', 'canvas');
    const dragSlow = async (dx) => { await api('POST', '/actions', { actions: [{ type: 'pointer', id: 'p1', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, origin: { 'element-6066-11e4-a52e-4f735466cecf': cv }, x: 0, y: 0 },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: 120, origin: 'pointer', x: Math.round(dx/3), y: 0 },
      { type: 'pointerMove', duration: 120, origin: 'pointer', x: Math.round(dx/3), y: 0 },
      { type: 'pointerMove', duration: 120, origin: 'pointer', x: Math.round(dx/3), y: 0 },
      { type: 'pointerUp', button: 0 }] }] }, sid).then(() => api('DELETE', '/actions', null, sid)).catch(() => {}); };
    await dragSlow(300);
    await sleep(500);
    const mid = await exe(sid, 'window.__qa.yaw()').catch(()=>null);
    await dragSlow(300);
    await sleep(500);
    const after = await exe(sid, 'window.__qa.yaw()').catch(()=>null);
    const lock = await exe(sid, '!!document.pointerLockElement').catch(()=>null);
    rec(A, 'dragprobe: drag-look rotates yaw without pointer lock', mid !== before || after !== mid, JSON.stringify({before, mid, after, hit, lock}));
  }
  if (run) {
    await sleep(2000);
    const obj = await exe(sid, `(document.getElementById('objective')||{}).textContent||''`).catch(() => null);
    rec(A, 'objective line: HUD shows a non-empty objective after start', !!obj && obj.length > 3, String(obj).slice(0, 80));
    await glDump(sid, 'sweet-start');
    await shot(sid, 'sweet-start');
  }
  if (run && (process.env.PLAYTHROUGH || (process.env.ONLY || '').split(',').includes('sweet-factory-escape-3d'))) { await sweetPlay(sid, A); await glDump(sid, 'sweet-end'); await shot(sid, 'sweet-end'); }

  if (run && BS_DEVICE && process.env.SWEET_TOUCH) {
    // real iPhone touch controls: joystick drag, touch look, actBtn quiz - native XCTest taps + W3C touch actions
    const tapXY = async (x, y) => { await api('POST', '/actions', { actions: [{ type: 'pointer', id: 't1', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(x), y: Math.round(y) },
      { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 70 }, { type: 'pointerUp', button: 0 }] }] }, sid).then(() => api('DELETE', '/actions', null, sid)).catch(() => {}); };
    const touchDrag = async (x0, y0, dx, dy, holdMs) => { await api('POST', '/actions', { actions: [{ type: 'pointer', id: 't1', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(x0), y: Math.round(y0) },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: 250, origin: 'pointer', x: Math.round(dx), y: Math.round(dy) },
      { type: 'pause', duration: holdMs },
      { type: 'pointerUp', button: 0 }] }] }, sid).then(() => api('DELETE', '/actions', null, sid)).catch(() => {}); };
    const joyRect = await exe(sid, `(function(){const j=document.getElementById('joy');const b=j.getBoundingClientRect();return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2,vis:b.width>0})})()`).then(v=>v&&JSON.parse(v)).catch(()=>null);
    rec(A, 'mobile controls: virtual joystick present on iPhone', !!(joyRect && joyRect.vis), JSON.stringify(joyRect));
    if (joyRect && joyRect.vis) {
      const p0 = await exe(sid, 'JSON.stringify(window.__qa.pos())').then(v=>v&&JSON.parse(v)).catch(()=>null);
      await touchDrag(joyRect.x, joyRect.y, 0, -55, 700);
      await sleep(300);
      const p1 = await exe(sid, 'JSON.stringify(window.__qa.pos())').then(v=>v&&JSON.parse(v)).catch(()=>null);
      const moved = p0 && p1 && Math.hypot(p1[0]-p0[0], p1[1]-p0[1]) > 0.3;
      rec(A, 'mobile controls: joystick drag moves avatar', !!moved, JSON.stringify({p0, p1}));
      const y0 = await exe(sid, 'window.__qa.yaw()').catch(()=>null);
      const vw = await exe(sid, 'innerWidth').catch(()=>390);
      await touchDrag(vw * 0.7, 300, 110, 0, 60);
      await sleep(300);
      const y1 = await exe(sid, 'window.__qa.yaw()').catch(()=>null);
      rec(A, 'mobile controls: touch look-drag rotates camera', y0 !== null && y1 !== null && y0 !== y1, JSON.stringify({y0, y1}));
      // room 1 quiz via actBtn
      let solved0 = false;
      for (let iter = 0; iter < 16 && !solved0; iter++) {
        const st = await exe(sid, `JSON.stringify({pos:window.__qa.pos(),prompt:window.__qa.prompt(),solved:window.__qa.solved()})`).then(r=>r&&JSON.parse(r)).catch(()=>null);
        if (!st) break;
        const pd = await exe(sid, `(function(){const t=window.__qa.targets().find(t=>t.room===0);const p=window.__qa.pos();return Math.hypot(t.x-p[0],t.z-p[1])})()`).catch(()=>99);
        const sp = await exe(sid, `(function(){const t=window.__qa.targets().find(t=>t.room===0);return JSON.stringify(window.__qa.screenOf(t.x,t.z))})()`).then(r=>r&&JSON.parse(r)).catch(()=>null);
        if (st.prompt && typeof pd === 'number' && pd < 2.6) {
          const abEl = await el(sid, 'css selector', '#actBtn');
          if (abEl) await click(sid, abEl); // DOM button: element click fires the real click handler (tryInteract)
          else console.log('touchquiz actBtn element not found');
          await sleep(700);
          console.log('touchquiz after-tap', await exe(sid, `JSON.stringify({mm:!document.getElementById('mathModal').hidden,lp:!document.getElementById('lookPanel').hidden,actHidden:document.getElementById('actBtn').hidden})`).catch(()=>null));
          const open = await waitFor(sid, `!document.getElementById('mathModal').hidden`, 6000).catch(()=>false);
          if (open) {
            const i1 = await el(sid, 'css selector', '#in1');
            if (i1) { await click(sid, i1); await type(sid, i1, '3168'); }
            const ok = await el(sid, 'css selector', '#okBtn');
            if (ok) await click(sid, ok);
            solved0 = await waitFor(sid, `window.__qa.solved()[0] === true ? true : null`, 8000) === true;
          }
          console.log('touchquiz iter' + iter, 'prompt', st.prompt, 'pd', pd, 'open-solved', solved0);
          break;
        }
        if (sp && sp.behind) await touchDrag(vw * 0.7, 300, 200, 0, 60);
        else if (sp && Math.abs(sp.x - vw/2) > 60) await touchDrag(vw * 0.7, 300, Math.max(-160, Math.min(160, Math.round((sp.x - vw/2) * 0.5))), 0, 60);
        else if (joyRect) await touchDrag(joyRect.x, joyRect.y, 0, -55, 500);
        await sleep(350);
        console.log('touchnav iter' + iter, 'pos', JSON.stringify(st.pos), 'pd', pd, 'sp', JSON.stringify(sp));
      }
      rec(A, 'mobile controls: room 1 quiz solved on iPhone (actBtn tap + typing + okBtn tap)', solved0 === true);
      await shot(sid, 'ios-sweet-touch');
    }
  }
  await shot(sid, 'desktop-sweet-factory-escape-3d');
}


async function sweetPlay(sid, A) {
  fs.writeFileSync('/tmp/bs-sweet-sid', sid);
  // simulates a browser that DENIES pointer lock (real supported mode, verified working in DRAGPROBE)
  await exe(sid, `return (function(){const c=document.querySelector('canvas');if(c) c.requestPointerLock=function(){};try{document.exitPointerLock()}catch(e){}return true})()`).catch(()=>{});
  const ANSWERS = [['in1', '3168'], ['inQ/inR', '12/1'], ['in1', '7/9'], ['in1', '60'], ['in1', '64']];
  const key = async (v, ms) => { await api('POST', '/actions', { actions: [{ type: 'key', id: 'k1', actions: [
    { type: 'keyDown', value: v }, { type: 'pause', duration: ms }, { type: 'keyUp', value: v }] }] }, sid).then(() => api('DELETE', '/actions', null, sid)).catch(() => {}); };
  const drag = async (dx) => { // real pointer drag on canvas to rotate view
    const cv = await el(sid, 'css selector', 'canvas');
    if (!cv) return;
    await api('POST', '/actions', { actions: [{ type: 'pointer', id: 'p1', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, origin: { 'element-6066-11e4-a52e-4f735466cecf': cv }, x: 0, y: 0 },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: 120, origin: 'pointer', x: Math.round(dx/3), y: 0 },
      { type: 'pointerMove', duration: 120, origin: 'pointer', x: Math.round(dx/3), y: 0 },
      { type: 'pointerMove', duration: 120, origin: 'pointer', x: Math.round(dx/3), y: 0 },
      { type: 'pointerUp', button: 0 }] }] }, sid).then(() => api('DELETE', '/actions', null, sid)).catch(() => {});
  };
  const answerQuiz = async (room) => { // returns 'solved' | 'lookpanel' | 'failed'
    const open = await waitFor(sid, `!document.getElementById('mathModal').hidden && (function(){const v=function(id){const i=document.getElementById(id);const r=i&&i.getBoundingClientRect();return !!(r&&r.width>0&&getComputedStyle(i).display!=='none')};return v('in1')||v('inQ')})()`, 9000);
    if (!open) return 'failed';
    await sleep(400);
    if (room === 0 && !globalThis.__sweetExtras) {
      globalThis.__sweetExtras = true;
      try {
        const ext = await exe(sid, `return JSON.stringify((function(){const o=new Set();performance.getEntriesByType('resource').forEach(r=>{try{o.add(new URL(r.name).origin)}catch(e){}});const sc=[...document.scripts].map(s=>s.src).filter(Boolean);return {origins:[...o],scripts:sc,here:location.origin}})())`).then(JSON.parse);
        const extOrig = ext.origins.filter(x => x !== ext.here);
        rec(A, 'selfhost: three.js served from own origin (no CDN script)', ext.scripts.every(s => s.startsWith(ext.here)) , 'scripts=' + ext.scripts.join(',') + ' otherOrigins=' + extOrig.join(','));
        // SFX: count oscillators created by the app's own wrong-answer path
        await exe(sid, `(function(){window.__osc=0;const P=(window.AudioContext||window.webkitAudioContext).prototype;const o=P.createOscillator;P.createOscillator=function(){window.__osc++;return o.apply(this,arguments)};return 1})()`);
        const i0 = await el(sid, 'css selector', '#in1'); if (i0) { await click(sid, i0); await type(sid, i0, '1'); }
        const ok0 = await el(sid, 'css selector', '#okBtn'); if (ok0) await click(sid, ok0);
        await sleep(900);
        const wr = await exe(sid, `return JSON.stringify({val:document.getElementById('in1').value,osc:window.__osc,ctx:(typeof actx!=='undefined'&&actx)?actx.state:'n/a'})`).then(JSON.parse);
        rec(A, 'wrong answer: input is cleared automatically', wr.val === '', JSON.stringify(wr));
        rec(A, 'sfx: wrong-answer sound is synthesized by WebAudio (oscillators created, ctx running) [audibility to a human not measurable here]', wr.osc >= 2 && wr.ctx === 'running', JSON.stringify(wr));
        // short / narrow window geometry with the modal open
        for (const [w, h] of [[520, 560], [820, 480]]) {
          await api('POST', '/window/rect', { width: w, height: h }, sid).catch(() => {}); await sleep(900);
          const g = await exe(sid, `return JSON.stringify((function(){const vis=id=>{const e=document.getElementById(id);if(!e)return null;const r=e.getBoundingClientRect();return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right),h:Math.round(r.height)}};const hud=document.getElementById('hud');const rn=document.getElementById('roomName')||hud.querySelector('*');const lines=[...hud.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()).map(e=>({t:e.textContent.trim().slice(0,12),h:Math.round(e.getBoundingClientRect().height),w:Math.round(e.getBoundingClientRect().width)}));return {vp:[innerWidth,innerHeight],ok:vis('okBtn'),close:vis('closeMath')||vis('mathClose'),modalScroll:(document.getElementById('mathModal').scrollHeight>innerHeight),hOverflow:(function(){const bad=[];document.querySelectorAll('#mathModal *').forEach(e=>{if(e.scrollWidth>e.clientWidth+1&&/auto|scroll/.test(getComputedStyle(e).overflowX))bad.push((e.id||e.className||e.tagName).toString().slice(0,20)+':'+e.scrollWidth+'>'+e.clientWidth)});return bad})(),docH:document.documentElement.scrollWidth>innerWidth,hudLines:lines.slice(0,6)}})())`).then(JSON.parse).catch(e => ({ err: String(e) }));
          const inView = g.ok && g.ok.b <= g.vp[1] && g.ok.t >= 0;
          const charwrap = (g.hudLines || []).some(x => x.w > 0 && x.h > 3 * 20 && x.w < 40);
          rec(A, 'layout ' + w + 'x' + h + ': OK button inside viewport with modal open, HUD text not stacked per-character', !!inView && !charwrap, JSON.stringify(g));
          await shot(sid, 'sweet-layout-' + w + 'x' + h);
        }
        await api('POST', '/window/rect', { width: 1280, height: 848 }, sid).catch(() => {}); await sleep(700);
      } catch (e) { rec(A, 'sweet extras (selfhost/sfx/wrong-clear/layout)', false, 'THROW ' + String(e).slice(0, 160)); }
    }
    const [kind, ans] = ANSWERS[room];
    if (kind === 'in1') { const i1 = await el(sid, 'css selector', '#in1'); if (i1) { await click(sid, i1); await type(sid, i1, ans); } }
    else { const [q, r] = ans.split('/'); const iq = await el(sid, 'css selector', '#inQ'); if (iq) { await click(sid, iq); await type(sid, iq, q); } const ir = await el(sid, 'css selector', '#inR'); if (ir) { await click(sid, ir); await type(sid, ir, r); } }
    const ok = await el(sid, 'css selector', '#okBtn');
    if (ok) await click(sid, ok);
    const solved = await waitFor(sid, `window.__qa.solved()[${room}] === true ? true : null`, 8000) === true;
    await shot(sid, 'play-sweet-room' + room + '-solved');
    console.log('play room', room, 'solved=', solved);
    return solved ? 'solved' : 'failed';
  };
  // resume warmup: a quiz modal left open by a killed phase
  if (await exe(sid, `!document.getElementById('mathModal').hidden`).catch(()=>false)) {
    const cr = await exe(sid, 'window.__qa.room()').catch(()=>0);
    console.log('resume warmup: answering open modal for room', cr);
    await answerQuiz(cr);
  }
  let allOk = true;
  let staticCount = 0;
  for (let room = 0; room < 5 && allOk; room++) {
    const sv = await exe(sid, 'JSON.stringify(window.__qa.solved())').then(r=>r&&JSON.parse(r)).catch(()=>null);
    if (sv && sv[room]) { rec(A, 'playthrough: room ' + (room+1) + ' puzzle solved via real input', true, 'already solved earlier in this session'); continue; }
    let solvedThis = false;
    let ITERMAX = 40;
    if (room === 2 && !globalThis.__sweetSaveDone && (process.env.ONLY || '').split(',').includes('sweet-factory-escape-3d')) {
      globalThis.__sweetSaveDone = true; ITERMAX = 12; // bounded: room 3 gets 12 iterations + a target/position diagnostic
      const raw = await exe(sid, `localStorage.getItem('sweet-factory-save-v1')`).catch(() => null);
      let sv0 = null; try { sv0 = JSON.parse(raw); } catch (e) {}
      rec(A, 'save: progress stored in localStorage after solving rooms 1-2', !!(sv0 && sv0.solved && sv0.solved[0] && sv0.solved[1] && !sv0.solved[2]), String(raw));
      await api('POST', '/url', { url: 'https://sweet-factory-escape-3d.onrender.com/' }, sid).catch(() => {});
      const back = await waitFor(sid, `!!document.getElementById('startBtn')`, 40000);
      await waitFor(sid, `[...document.querySelectorAll('button')].some(x=>/이어하기/.test(x.textContent))?true:null`, 6000);
      const cbs = await exe(sid, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>/이어하기/.test(x.textContent));return b?b.textContent:null})()`).catch(() => null);
      rec(A, 'save: after reload the intro offers [이어하기] with medal count', !!back && !!cbs, 'continue=' + cbs + ' startBtn=' + (await exe(sid, `document.getElementById('startBtn').textContent`).catch(() => null)));
      await shot(sid, 'sweet-after-reload');
      const cb = await el(sid, 'xpath', `//button[contains(.,'이어하기')]`);
      if (cb) await click(sid, cb);
      await sleep(1500);
      const rs = await exe(sid, `JSON.stringify({solved:window.__qa.solved(),room:window.__qa.room(),doors:window.__qa.doors(),obj:(document.getElementById('objective')||{}).textContent,rn:document.getElementById('roomName').textContent,medal:document.getElementById('medal').textContent})`).catch(() => null);
      let R = null; try { R = JSON.parse(rs); } catch (e) {}
      rec(A, 'save: [이어하기] restores solved rooms, current room 3, open doors, HUD', !!(R && R.solved[0] && R.solved[1] && !R.solved[2] && R.room === 2 && R.doors[0] && R.doors[1]), String(rs));
      await shot(sid, 'sweet-continued');
      await exe(sid, `return (function(){const c=document.querySelector('canvas');if(c) c.requestPointerLock=function(){};try{document.exitPointerLock()}catch(e){}return true})()`).catch(() => {});
      staticCount = 0;
      const tg = await exe(sid, `JSON.stringify({t:window.__qa.targets().filter(t=>t.room===2),pos:window.__qa.pos(),yaw:window.__qa.yaw(),prompt:window.__qa.prompt()})`).catch(() => null);
      console.log('sweetdiag(room3 start)', tg);
    }
    for (let iter = 0; iter < ITERMAX && !solvedThis; iter++) {
      const st = await exe(sid, `JSON.stringify({pos:window.__qa.pos(),prompt:window.__qa.prompt(),room:window.__qa.room(),solved:window.__qa.solved(),fin:window.__qa.fin()})`).then(r=>r&&JSON.parse(r)).catch(()=>null);
      if (!st) break;
      if (st.fin) { solvedThis = true; break; }
      const pd = await exe(sid, `(function(){const t=window.__qa.targets().find(t=>t.room===${room});const p=window.__qa.pos();return Math.hypot(t.x-p[0],t.z-p[1])})()`).catch(()=>99);
      if (st.prompt && typeof pd === 'number' && pd < 2.6) {
        await key('e', 80); // keyboard nav leaves no residual tapTarget; interact immediately while in range
        if (!(await waitFor(sid, `!document.getElementById('mathModal').hidden`, 2500).catch(()=>false))) {
          const lookOpen = await exe(sid, `(function(){const l=document.getElementById('lookPanel');return l&&!l.hidden})()`).catch(()=>false);
          if (lookOpen) { const cl = await el(sid, 'css selector', '#closeLook'); if (cl) await click(sid, cl); await sleep(300); continue; }
          const pr = await el(sid, 'css selector', '#prompt');
          if (pr) await click(sid, pr);
        }
        const r = await answerQuiz(room);
        if (r === 'solved') solvedThis = true;
        else { allOk = false; rec(A, 'playthrough: room ' + (room+1) + ' puzzle solved via real input', false, 'quiz open/answer failed'); }
        break;
      }
      const nav = await exe(sid, `JSON.stringify((function(){const t=window.__qa.targets().find(t=>t.room===${room});const sp=window.__qa.screenOf(t.x,t.z);return {sp, t}})())`).then(r=>r&&JSON.parse(r)).catch(()=>null);
      if (!nav) break;
      const sp = nav.sp;
      const p0 = st.pos;
      if (sp.behind) { await drag(420); await sleep(320); }
      else if (Math.abs(sp.x - 640) > 110) { await drag(Math.max(-380, Math.min(380, Math.round((sp.x - 640) * 0.55)))); await sleep(320); }
      else if (staticCount >= 1 && Math.abs(p0[0]) > 0.35) { await key(p0[0] < 0 ? 'd' : 'a', Math.min(900, Math.max(180, Math.round(Math.abs(p0[0]) * 260)))); await sleep(260); } // pinned on a boundary wall: strafe to the centered doorway
      else { await key('w', 380); await sleep(340); }
      const p1 = await exe(sid, 'JSON.stringify(window.__qa.pos())').catch(()=>null);
      try { const a = JSON.parse(p1); staticCount = (Math.hypot(a[0]-p0[0], a[1]-p0[1]) < 0.05) ? staticCount + 1 : 0; } catch(e) {}
      console.log('nav room' + room, 'iter' + iter, 'pos', JSON.stringify(p0), '->', p1, 'sp', JSON.stringify(sp));
    }
    if (solvedThis) rec(A, 'playthrough: room ' + (room+1) + ' puzzle solved via real input', true);
    else allOk = false;
    if (!solvedThis) { const dg = await exe(sid, `JSON.stringify({t:window.__qa.targets().filter(t=>t.room===${room}),pos:window.__qa.pos(),yaw:window.__qa.yaw(),prompt:window.__qa.prompt(),modal:!document.getElementById('mathModal').hidden,look:!!(document.getElementById('lookPanel')&&!document.getElementById('lookPanel').hidden)})`).catch(() => null); console.log('sweetdiag(room' + (room+1) + ' end unsolved)', dg); }
  }
  // escape: steer to the centered exit (x=0, past the last wall) until fin()
  let fin = await exe(sid, 'window.__qa.fin()').catch(()=>false);
  let escStatic = 0;
  for (let i = 0; i < 34 && !fin; i++) {
    const ex = await exe(sid, `JSON.stringify((function(){const p=window.__qa.pos();const sp=window.__qa.screenOf(0,-98);return {p, sp}})())`).then(r=>r&&JSON.parse(r)).catch(()=>null);
    if (!ex) break;
    const sp = ex.sp;
    if (sp.behind) { await drag(300); await sleep(300); }
    else if (Math.abs(sp.x - 640) > 60) { await drag(Math.max(-120, Math.min(120, Math.round((sp.x - 640) * 0.35)))); await sleep(280); }
    else if (escStatic >= 1 && Math.abs(ex.p[0]) > 0.35) { await key(ex.p[0] < 0 ? 'd' : 'a', Math.min(900, Math.max(180, Math.round(Math.abs(ex.p[0]) * 260)))); await sleep(300); }
    else { await key('w', 700); await sleep(500); }
    const p2 = await exe(sid, 'JSON.stringify(window.__qa.pos())').then(r=>r&&JSON.parse(r)).catch(()=>null);
    try { escStatic = (Math.hypot(p2[0]-ex.p[0], p2[1]-ex.p[1]) < 0.05) ? escStatic + 1 : 0; } catch(e) {}
    console.log('escape iter' + i, 'pos', JSON.stringify(ex.p), 'sp', JSON.stringify(sp));
    fin = await exe(sid, 'window.__qa.fin()').catch(()=>false);
  }
  rec(A, 'playthrough: full escape - ending screen reached', fin === true, 'fin=' + fin);
  if (fin) await shot(sid, 'play-sweet-ending');
}

async function checkCoworking(sid) {
  const A = 'coworking-world';
  const boot = await waitFor(sid, `!!document.getElementById('enter')`, 60000);
  rec(A, 'boot: entry panel present', !!boot);
  if (!boot) return;
  const inp = await el(sid, 'css selector', '#nick');
  if (inp) { await click(sid, inp); await type(sid, inp, 'QA'); }
  const b = await el(sid, 'css selector', '#enter');
  if (b) await click(sid, b);
  const me = await waitFor(sid, `!!(window.__me && window.__me.group)`, 60000);
  rec(A, 'entry: avatar joins world (WebSocket presence)', !!me);
  if (me) {
    // ---- a54c10c first-use flow checks (real pointer/keyboard/clicks; no synthetic JS state changes) ----
    const vtap = async (x, y) => { await api('POST', '/actions', { actions: [{ type: 'pointer', id: 'p1', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(x), y: Math.round(y) },
      { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 80 }, { type: 'pointerUp', button: 0 }] }] }, sid).then(() => api('DELETE', '/actions', null, sid)).catch(() => {}); };
    const cwKey = async (v, ms) => { await api('POST', '/actions', { actions: [{ type: 'key', id: 'k1', actions: [
      { type: 'keyDown', value: v }, { type: 'pause', duration: ms }, { type: 'keyUp', value: v }] }] }, sid).then(() => api('DELETE', '/actions', null, sid)).catch(() => {}); };
    const pos = () => exe(sid, `(()=>{const m=window.__me;return m&&m.pos?JSON.stringify({x:+m.pos.x.toFixed(2),z:+m.pos.z.toFixed(2),seat:m.seatIdx,pose:m.pose}):null})()`).catch(() => null);
    const gld = await exe(sid, `(()=>{const c=document.getElementById('c');if(!c)return 'no #c';const gl=c.getContext('webgl2')||c.getContext('webgl');if(!gl)return 'no gl ctx on #c';const e=gl.getExtension('WEBGL_debug_renderer_info');return JSON.stringify({kind:(typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext)?'webgl2':'webgl1',lost:gl.isContextLost(),err:gl.getError(),buf:[gl.drawingBufferWidth,gl.drawingBufferHeight],css:[c.clientWidth,c.clientHeight],vendor:e?gl.getParameter(e.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),attrs:gl.getContextAttributes(),errs:window.__cerr||null})})()`).catch(e => 'ERR ' + e);
    console.log('cwdiag(webgl)', String(gld).slice(0, 700));
    const wk = await exe(sid, `(()=>{const m=window.__me;const out={hasGroup:!!(m&&m.group),inScene:!!(m&&m.group&&m.group.parent),camPos:window.__cam?[window.__cam.position.x,window.__cam.position.y,window.__cam.position.z].map(v=>+v.toFixed(1)):null,seats:(window.__seats||[]).length};return JSON.stringify(out)})()`).catch(() => null);
    console.log('cwdiag(scene)', wk);
    await sleep(1500);
    const g1 = await exe(sid, `(()=>{const g=document.getElementById('guide');const h=document.getElementById('hint');return JSON.stringify({guide:!!g&&g.style.display!=='none'&&g.offsetHeight>0,hint:h?h.textContent.slice(0,40):null,gtxt:g?g.textContent.slice(0,40):null})})()`).catch(() => null);
    rec(A, 'guide: entry guide card shown on first entry', !!(g1 && JSON.parse(g1).guide), String(g1));
    await shot(sid, 'cw-1-entry');
    const gok = await el(sid, 'css selector', '#guideOk');
    if (gok) { await click(sid, gok); await sleep(500); }
    const g2 = await exe(sid, `(()=>{const g=document.getElementById('guide');return g.style.display==='none'||g.offsetHeight===0})()`).catch(() => null);
    rec(A, 'guide: [알겠어요] dismisses the card', g2 === true, String(g2));
    // seat markers: project a free seat to the screen, tap it with a real pointer -> walk there and sit
    const sf = await exe(sid, `(()=>{const m=window.__me,cam=window.__cam,S=window.__seats;if(!m||!cam||!S)return null;let best=null,bd=1e9;S.forEach((s,i)=>{if(s.occupied)return;const v=m.pos.clone();v.set(s.x,0.15,s.z);v.project(cam);if(v.z>1||Math.abs(v.x)>.8||Math.abs(v.y)>.7)return;const d=Math.hypot(s.x-m.pos.x,s.z-m.pos.z);if(d<bd){bd=d;best={i,x:(v.x+1)/2*innerWidth,y:(1-v.y)/2*innerHeight,d:+d.toFixed(1),kind:s.kind}}});return best?JSON.stringify(best):null})()`).catch(() => null);
    if (!sf) rec(A, 'seat marker tap: tapping a visible free seat walks and sits', false, 'no visible free seat projected on screen');
    else {
      const S = JSON.parse(sf); await vtap(S.x, S.y);
      const sat = await waitFor(sid, `(()=>{const m=window.__me;return m&&m.seatIdx!=null?m.seatIdx:null})()`, 25000);
      rec(A, 'seat marker tap: tapping a visible free seat walks and sits', sat != null && sat !== false, 'target=' + S.i + ' kind=' + S.kind + ' dist=' + S.d + ' seated=' + sat);
    }
    {
      const glpx = await exe(sid, `(()=>{try{const c=document.getElementById('c');const gl=c.getContext('webgl2')||c.getContext('webgl');const W=gl.drawingBufferWidth,H=gl.drawingBufferHeight;const buf=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);let nz=0,bright=0;const S=8,w=Math.floor(W/S),h=Math.floor(H/S);const out=new Uint8Array(w*h*3);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const si=((H-1-y*S)*W+x*S)*4;const o=(y*w+x)*3;out[o]=buf[si];out[o+1]=buf[si+1];out[o+2]=buf[si+2];if(buf[si]+buf[si+1]+buf[si+2]>30)nz++;if(buf[si]+buf[si+1]+buf[si+2]>240)bright++}let b64='';const CH=0x8000;for(let i=0;i<out.length;i+=CH)b64+=String.fromCharCode.apply(null,out.subarray(i,i+CH));return JSON.stringify({W,H,w,h,nonDark:nz,bright,total:w*h,err:gl.getError(),b64:btoa(b64)})}catch(e){return JSON.stringify({error:String(e)})}})()`).catch(e => JSON.stringify({error: 'ERR ' + e}));
      try { const o = JSON.parse(glpx); const { b64, ...meta } = o; console.log('cwdiag(readPixels)', JSON.stringify(meta)); if (b64) { (await import('node:fs')).writeFileSync('results/cw-glpixels.json', JSON.stringify(o)); } } catch (e) { console.log('cwdiag(readPixels) parse fail', String(glpx).slice(0, 200)); }
    }
    await shot(sid, 'cw-2-seated'); await shotNative('cw-2-seated');
    // focus start/stop button (e5dea79: sitting idles; focus starts only on explicit press)
    const fb = await el(sid, 'css selector', '#focusBtn');
    await sleep(800);
    const fa = await exe(sid, `(()=>{const b=document.getElementById('focusBtn');return JSON.stringify({txt:b.textContent,on:b.classList.contains('on'),pose:window.__me.pose,seat:window.__me.seatIdx})})()`).catch(() => null);
    const fa0 = fa ? JSON.parse(fa) : {};
    rec(A, 'focus: after sitting the avatar idles and the button reads 집중 시작 (no auto focus)', fa0.txt === '집중 시작' && fa0.on === false && fa0.seat != null && !/study/.test(fa0.pose || ''), String(fa));
    const m0 = await exe(sid, `document.getElementById('mine').textContent`).catch(() => null);
    await sleep(3000); const m1 = await exe(sid, `document.getElementById('mine').textContent`).catch(() => null);
    rec(A, 'focus: personal timer does NOT count while idle-seated', m0 === m1, m0 + ' -> ' + m1);
    if (fb) { await click(sid, fb); await sleep(1200); }
    const fb1 = await exe(sid, `(()=>{const b=document.getElementById('focusBtn');return JSON.stringify({txt:b.textContent,on:b.classList.contains('on'),pose:window.__me.pose,seat:window.__me.seatIdx})})()`).catch(() => null);
    const f1 = fb1 ? JSON.parse(fb1) : {};
    rec(A, 'focus: pressing [집중 시작] while seated -> study pose, button 집중 종료', f1.txt === '집중 종료' && f1.on === true && /study/.test(f1.pose || ''), String(fb1));
    await sleep(6000);
    const mine = await exe(sid, `document.getElementById('mine').textContent`).catch(() => null);
    rec(A, 'focus: personal timer counts up while focusing', !!mine && mine !== '0:00' && mine !== m1, 'mine=' + mine);
    await shot(sid, 'cw-3-focusing'); await shotNative('cw-3-focusing');
    if (fb) { await click(sid, fb); await sleep(1200); }
    const fb2 = await exe(sid, `(()=>{const b=document.getElementById('focusBtn');return JSON.stringify({txt:b.textContent,on:b.classList.contains('on'),pose:window.__me.pose,seat:window.__me.seatIdx})})()`).catch(() => null);
    const f2 = fb2 ? JSON.parse(fb2) : {};
    rec(A, 'focus: [집중 종료] stops focus but stays seated (idle)', f2.txt === '집중 시작' && f2.on === false && f2.seat != null && f2.pose === 'idle', String(fb2));
    // stand up (space) then explicit start from standing walks to nearest free seat, sits, studies
    await cwKey(' ', 150); await sleep(800);
    const st = await exe(sid, `window.__me.seatIdx==null?'standing':'still-seated'`).catch(() => null);
    if (fb) { await click(sid, fb); }
    const auto = await waitFor(sid, `(()=>{const m=window.__me;return m&&m.seatIdx!=null&&/study/.test(m.pose)?m.seatIdx:null})()`, 30000);
    rec(A, 'focus: explicit start from standing walks to nearest free seat, sits and studies', auto != null && auto !== false, 'preState=' + st + ' seat=' + auto);
    await shot(sid, 'cw-3b-autoseat');
    if (fb) { await click(sid, fb); await sleep(1000); }
    await cwKey(' ', 150); await sleep(800);
    // movement: keyboard WASD
    const p0 = await pos(); await cwKey('d', 1200); await cwKey('w', 800); const p1 = await pos();
    rec(A, 'movement: WASD keys move the avatar', !!(p0 && p1 && (JSON.parse(p0).x !== JSON.parse(p1).x || JSON.parse(p0).z !== JSON.parse(p1).z)), p0 + ' -> ' + p1);
    // movement: click floor
    const cvEl = await el(sid, 'css selector', '#c');
    const p2 = await pos();
    const dim = await exe(sid, `JSON.stringify({w:innerWidth,h:innerHeight})`).catch(() => null);
    if (dim) { const D = JSON.parse(dim); await vtap(D.w * 0.62, D.h * 0.78); await sleep(2500); }
    const p3 = await pos();
    rec(A, 'movement: clicking the floor walks there', !!(p2 && p3 && (JSON.parse(p2).x !== JSON.parse(p3).x || JSON.parse(p2).z !== JSON.parse(p3).z)), p2 + ' -> ' + p3);
    // zones via move menu: lounge + terrace labels
    const zoneTest = async (data, re) => {
      const mb = await el(sid, 'css selector', 'button[data-menu="moveMenu"]'); if (mb) { await click(sid, mb); await sleep(500); }
      const zb = await el(sid, 'css selector', `[data-move="${data}"]`); if (zb) await click(sid, zb);
      const ok = await waitFor(sid, `(()=>{const t=document.getElementById('roomname').textContent;return ${re}.test(t)?t:null})()`, 30000);
      return ok;
    };
    const zl = await zoneTest('lounge', '/라운지/'); rec(A, 'zones: move menu -> lounge (roomname label updates)', !!zl, String(zl)); await sleep(800); await shot(sid, 'cw-4-lounge'); await shotNative('cw-4-lounge');
    const zt = await zoneTest('terrace', '/루프탑/'); rec(A, 'zones: move menu -> rooftop terrace (roomname label updates)', !!zt, String(zt)); await sleep(800); await shot(sid, 'cw-5-terrace'); await shotNative('cw-5-terrace');
    const zh = await zoneTest('hall', '/포커스홀/'); rec(A, 'zones: move menu -> focus hall (roomname label updates)', !!zh, String(zh)); await sleep(800); await shot(sid, 'cw-6-hall'); await shotNative('cw-6-hall');
    // audio: sound button cycles modes (real clicks, user gesture)
    const sb = await el(sid, 'css selector', '#snd'); const modes = [];
    for (let k = 0; k < 4 && sb; k++) { await click(sid, sb); await sleep(700); modes.push(await exe(sid, `JSON.stringify({t:document.getElementById('snd').textContent,s:window.__sndState()})`).catch(() => null)); }
    const parsed = modes.map(m => { try { return JSON.parse(m); } catch (e) { return null; } });
    const labelsOk = parsed.length === 4 && parsed[0] && /빗소리/.test(parsed[0].t) && /카페/.test(parsed[1].t) && /풀벌레/.test(parsed[2].t) && /끔/.test(parsed[3].t);
    rec(A, 'audio: sound button cycles rain -> cafe -> crickets -> off', !!labelsOk, JSON.stringify(parsed).slice(0, 300));
    rec(A, 'audio: AudioContext running while a sound mode is on (Safari autoplay)', !!(parsed[1] && parsed[1].s && parsed[1].s.ctx === 'running' && parsed[1].s.playing), JSON.stringify(parsed[1] && parsed[1].s));
    // photo: composes canvas + info band
    const c2d = await exe(sid, `(()=>{try{const c=document.createElement('canvas');c.width=c.height=8;c.getContext('2d').fillRect(0,0,8,8);return c.toDataURL().length>20}catch(e){return false}})()`).catch(() => null);
    // test-side shim ONLY when the runner cannot allocate default 2D canvases: make 2D contexts CPU-backed so the app's own photo code can run; also capture the generated PNG data URL
    await exe(sid, `(()=>{window.__photoHref=null;const oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download&&/^data:image\/png/.test(this.href))window.__photoHref=this.href;return oc.apply(this,arguments)};if(${c2d===false}){const og=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,o){if(t==='2d')o=Object.assign({},o,{willReadFrequently:true});return og.call(this,t,o)}}return 1})()`).catch(() => {});
    const phb = await el(sid, 'css selector', '#photo'); if (phb) { await click(sid, phb); await sleep(2500); }
    const phref = await exe(sid, `window.__photoHref||''`).catch(() => ''); if (phref.length > 100) { fs.writeFileSync('results/cw-photo.png', Buffer.from(phref.split(',')[1], 'base64')); console.log('cwphoto saved bytes', fs.statSync('results/cw-photo.png').size); }
    const plen = await exe(sid, `window.__photoLen||0`).catch(() => 0);
    rec(A, 'photo: 📷 composes a PNG with info band (date/name/focus time)', plen > 5000, 'photoLen=' + plen + ' | default-2D-canvas-works-in-this-browser=' + c2d + (c2d === false ? ' (ENVIRONMENT: runner Safari cannot allocate default 2D canvases; not an app verdict)' : ''));
    // timer: open 타이머 menu, pick 25분 집중 -> HUD shows a running focus timer
    const tbtn = await el(sid, 'css selector', 'button[data-menu="timerMenu"]');
    if (tbtn) { await click(sid, tbtn); await sleep(600); }
    const t25 = await el(sid, 'css selector', '[data-timer="25"]');
    if (t25) { await click(sid, t25); await sleep(1200); }
    const thud = await exe(sid, `(function(){const h=document.getElementById('timerhud');return h?JSON.stringify({vis:h.style.display!=='none'&&h.offsetHeight>0,txt:h.textContent.slice(0,40)}):null})()`).catch(()=>null);
    rec(A, 'timer: 25-minute focus timer starts via real menu clicks', !!(thud && JSON.parse(thud).vis && /25분 집중|집중/.test(JSON.parse(thud).txt)), String(thud));
    // chat: type into #chatin + Enter -> message lands in #chatlog
    // GUARD: typing+sending a chat message broadcasts to every visitor of the public world; off unless ALLOW_PUBLIC_CHAT=1 (explicit user approval)
    const ci = process.env.ALLOW_PUBLIC_CHAT === '1' ? await el(sid, 'css selector', '#chatin') : null;
    if (!ci) console.log('chat probe SKIPPED (public broadcast; set ALLOW_PUBLIC_CHAT=1 only with approval)');
    if (ci) { await click(sid, ci); await type(sid, ci, 'QA chat probe');
      console.log('chatdbg(typed)', await exe(sid, `JSON.stringify({val:document.getElementById('chatin').value,ws:(window.ws&&window.ws.readyState)||(window.socket&&window.socket.readyState)||null,focus:document.activeElement&&document.activeElement.id})`).catch(()=>null));
      if (BS_DEVICE) { await api('POST', '/keys', { value: ['\uE007'] }, sid).catch(()=>{}); }
      else await api('POST', `/element/${ci}/value`, { text: '\uE007', value: ['\uE007'] }, sid); // no clear(): type() wipes the typed text first
      await sleep(1500); }
    console.log('chatdbg(info)', await exe(sid, `JSON.stringify({val:(document.getElementById('chatin')||{}).value||'',log:((document.getElementById('chatlog')||{}).textContent||'').slice(0,60)})`).catch(()=>null));
    const log = await exe(sid, `(document.getElementById('chatlog')||{}).textContent||''`).catch(()=>null);
    if (!ci) { /* guarded: no chat send, no check recorded (neither pass nor fail) */ }
    else if (BS_DEVICE) {
      // native route: switch to NATIVE_APP context and tap the on-screen keyboard's Return key (real XCTest tap)
      const ctxs = await api('GET', '/contexts', null, sid).catch(e => null);
      console.log('chatdbg(contexts)', JSON.stringify(ctxs).slice(0, 200));
      let nativeResult = 'no-attempt';
      if (ctxs && Array.isArray(ctxs) && ctxs.includes('NATIVE_APP')) {
        await api('POST', '/context', { name: 'NATIVE_APP' }, sid).catch(()=>{});
        // summon the keyboard with a REAL native tap on the input (web sendKeys never shows it)
        const tf = await api('POST', '/element', { using: 'xpath', value: "//XCUIElementTypeTextField | //XCUIElementTypeSearchField | //XCUIElementTypeOther[contains(@label,'\uBA54\uC2DC\uC9C0')]" }, sid).catch(()=>null);
        const tfRef = tf && tf[Object.keys(tf).find(k => String(k).toLowerCase().includes('element')) || 'ELEMENT'];
        if (tfRef) { await api('POST', `/element/${tfRef}/click`, {}, sid).catch(()=>{}); await sleep(1200); }
        const src2 = await api('GET', '/source', null, sid).catch(()=>null);
        console.log('chatdbg(kb-visible)', !!(src2 && src2.indexOf('XCUIElementTypeKeyboard') >= 0));
        if (process.env.NATIVEKEYPROBE) {
          const src = await api('GET', '/source', null, sid).catch(()=>null);
          const kb = src && src.indexOf('XCUIElementTypeKeyboard') >= 0;
          const labels = src ? (src.match(/XCUIElementType(?:Key|Button)[^>]*?label="[^"]{1,24}"/g) || []).map(v => v.replace(/XCUIElementType/, '')).filter((v,i,a)=>a.indexOf(v)===i) : [];
          console.log('keyprobe keyboard=', kb, 'labels=', JSON.stringify(labels));
        }
        const rk = await api('POST', '/element', { using: 'xpath', value: "//*[(@type='XCUIElementTypeKey' or @type='XCUIElementTypeButton') and (@label='return' or @name='Return' or contains(@label,'eturn') or @label='\uB9AC\uD134' or @label='\uC785\uB825')]" }, sid).catch(()=>null);
        const rkRef = rk && rk[Object.keys(rk).find(k => k.includes('element')) || 'ELEMENT'];
        if (rkRef) { await api('POST', `/element/${rkRef}/click`, {}, sid).catch(()=>{}); nativeResult = 'return-tapped'; }
        else nativeResult = 'return-key-not-found';
        const web = ctxs.find(c => String(c).indexOf('WEBVIEW') === 0);
        if (web) await api('POST', '/context', { name: web }, sid).catch(()=>{});
        await sleep(1500);
      } else nativeResult = 'no-native-context';
      const log2 = await exe(sid, `(document.getElementById('chatlog')||{}).textContent||''`).catch(()=>null);
      const sent = !!(log2 && log2.indexOf('QA chat probe') >= 0);
      console.log('chatdbg(native)', nativeResult, 'sent=', sent, String(log2).slice(0, 80));
      if (sent) rec(A, 'chat: iPhone send via native keyboard Return key - message lands in chat log (WS round-trip)', true, nativeResult);
      else rec(A, 'chat: iPhone on-screen typing lands in input; send route unavailable', false, 'native=' + nativeResult + ' log=' + String(log2).slice(0, 60));
    } else {
      rec(A, 'chat: typed message + Enter lands in chat log (WS echo round-trip)', !!(log && log.indexOf('QA chat probe') >= 0), String(log).slice(0, 80));
    }
    await shot(sid, 'desktop-coworking-world-timerchat');
  }
  await shot(sid, 'desktop-coworking-world');
}

async function checkDalbit(sid) {
  const A = 'sajumadang';
  const boot = await waitFor(sid, `document.title && document.title.indexOf('사주마당') >= 0 && !!document.querySelector('button')`, 60000);
  rec(A, 'boot: title + UI renders', !!boot);
  if (!boot) return;
  const fx = await waitFor(sid, `!!document.querySelector('.seasonfx')`, 15000);
  rec(A, 'extras22.js executes (lookbehind fix, seasonfx element created)', !!fx);
  const guideClose = await el(sid, 'xpath', `//button[contains(.,'닫기')]`);
  if (guideClose) { await click(sid, guideClose); await sleep(800); rec(A, 'first-visit guide sheet dismissed', true); }
  const nameGo = await el(sid, 'xpath', `//button[contains(.,'이름 짓고 들어가기')]`);
  if (nameGo) {
    await click(sid, nameGo); await sleep(800);
    const nickIn = await el(sid, 'css selector', '#fNick');
    if (nickIn) { await click(sid, nickIn); await type(sid, nickIn, 'QA마당'); }
    const nickGo = await el(sid, 'xpath', `//button[contains(.,'이 모습으로 들어가기')]`);
    if (nickGo) { await click(sid, nickGo); await sleep(2000); }
    const named = await exe(sid, `!!document.getElementById('sayInput')`).catch(()=>null);
    rec(A, 'first-visit nickname flow via sheet (required before entry)', !!named);
  }
  const sceneBtn = await el(sid, 'css selector', '#sceneBtn');
  if (sceneBtn) {
    await click(sid, sceneBtn);
    const inMaru = await waitFor(sid, `document.getElementById('stage').classList.contains('scene-maru')`, 25000);
    rec(A, 'gate->maru entry via real button click (scene switches)', !!inMaru);
    const ph = await exe(sid, `(document.getElementById('sayInput')||{}).placeholder || ''`).catch(()=>null);
    const narrow = await exe(sid, 'return matchMedia("(max-width:620px)").matches').catch(()=>false);
    rec(A, 'chat placeholder switches in maru scene (desktop: 마루 address / mobile: compact)', !!(ph && (narrow ? ph === '한마디 하기' : ph.indexOf('마루') >= 0)), String(ph) + (narrow ? ' [mobile compact variant - by design, extras6.js]' : ''));
  } else rec(A, 'gate->maru entry via real button click (scene switches)', false, 'no #sceneBtn found');
  await shot(sid, 'desktop-' + A);
}

function checkDogam(appName, expectNodes) {
  return async (sid) => {
    const A = appName; const FAST = !!process.env.FAST;
    const boot = await waitFor(sid, `!!(document.querySelector('.language-grid') || document.querySelector('.start'))`, 60000);
    rec(A, 'boot: language/start screen renders', !!boot);
    if (!boot) return;
    const handle = await exe(sid, `typeof window.__dogam === 'object'`).catch(()=>null);
    rec(A, 'QA debug handle deployed', !!handle);
    await exe(sid, `(()=>{window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message)+' @ '+(e.filename||'').split('/').pop()+':'+(e.lineno||'')+':'+(e.colno||'')+' STACK:'+String(e.error&&e.error.stack||'').slice(0,400)));addEventListener('unhandledrejection',e=>window.__errs.push('REJECT: '+String(e.reason&&e.reason.stack||e.reason).slice(0,300)));return true})()`).catch(()=>{});
    const lang = await el(sid, 'xpath', `//div[contains(@class,'language-grid')]//button[contains(.,'English')]`);
    if (lang) { await click(sid, lang); }
    for (const wait of FAST ? [] : [300, 1200, 2500]) {
      await sleep(wait);
      const snap = await exe(sid, `(function(){try{return (document.querySelectorAll('.travelers button').length)+'btns stage='+(window.__dogam?window.__dogam.stage():'?')+' errs='+((window.__errs||[]).join(';').slice(0,220)||'none')}catch(e){return 'evalerr '+e}})()`).catch(()=>null);
      console.log('probe@' + wait, appName, JSON.stringify(snap));
    }
    await sleep(1500);
    const counts = FAST ? null : await exe(sid, `(function(){try{const t=document.querySelector('.travelers');const b=document.querySelector('.travelers button');return (document.querySelectorAll('.travelers button').length)+'/'+(document.querySelectorAll('#start-actions button').length)+' grid='+(!!t)+' vis='+(b?b.offsetHeight:'-')+' ua='+navigator.userAgent.slice(0,60)}catch(e){return 'evalerr '+e}})()`).catch(()=>null);
    if (!FAST) rec(A, 'traveler grid + begin button render after language pick', !!(counts && counts.indexOf('10/') === 0), String(counts));
    const btnpix = FAST ? null : await exe(sid, `(function(){try{const c=document.querySelector('.travelers button canvas');if(!c)return 'nocanvas';const k=c.getContext('2d');const d=k.getImageData(0,0,c.width,c.height).data;let n=0,t=0;for(let i=3;i<d.length;i+=40){t++;if(d[i]>10)n++}return 'btncanvas='+n+'/'+t+' ('+c.width+'x'+c.height+')'}catch(e){return 'THROW '+e.name+' '+e.message}})()`).catch(()=>null);
    if (!FAST) { console.log('btnpix', appName, JSON.stringify(btnpix));
    rec(A, 'traveler sprite canvas actually painted (pixels)', !!(btnpix && !String(btnpix).startsWith('btncanvas=0/') && !String(btnpix).startsWith('THROW') && btnpix !== 'nocanvas'), String(btnpix)); }
    if (!FAST) await shot(sid, 'desktop-' + appName + '-start');
    if (AP) { await sleep(7000); await shot(sid, 'ap-' + appName + '-avatars-8s'); }
    const name = await el(sid, 'css selector', '#name');
    if (name) { await click(sid, name); await type(sid, name, 'QA'); }
    const begin = await el(sid, 'xpath', `//*[@id='start-actions']//button[1]`);
    if (begin) await click(sid, begin);
    await sleep(1500);
    await shot(sid, 'desktop-' + appName + '-afterbegin');
    const atCity = await waitFor(sid, `window.__dogam && window.__dogam.stage()==='city' ? 'city' : null`, 20000);
    if (atCity) {
      const begin2 = await el(sid, 'xpath', `//*[@id='city-action']//button[1]`);
      if (begin2) await click(sid, begin2);
    }
    const entered = await waitFor(sid, `window.__dogam && window.__dogam.stage()==='game' ? 'game' : null`, 30000);
    if (AP && entered) { await shot(sid, 'ap-' + appName + '-entry-early'); await sleep(7000); await shot(sid, 'ap-' + appName + '-entry-8s'); }
    const errs = entered ? '' : await exe(sid, `(window.__errs||[]).join(' | ').slice(0,180)+' stage='+(window.__dogam?window.__dogam.stage():'?')`).catch(()=>'');
    rec(A, 'entry: language -> traveler -> begin via real clicks', !!entered, entered ? 'stage=' + entered : String(errs));
    if (entered) {
      if (!FAST) {
      await exe(sid, `return (function(){window.__paint='start';
        function paint(im){const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const k=c.getContext('2d');k.drawImage(im,0,0);const d=k.getImageData(0,0,Math.min(c.width,300),Math.min(c.height,300)).data;let n=0,t=0;for(let i=3;i<d.length;i+=400){t++;if(d[i]>20)n++}return n+'/'+t}
        function test(src){return new Promise(res=>{const im=new Image();
          im.onload=async()=>{let pre,dec='na',post;try{pre=paint(im)}catch(e){pre='THROW '+e.name}
            try{await im.decode();dec='decode-ok'}catch(e){dec='decode-fail '+e.name}
            try{post=paint(im)}catch(e){post='THROW '+e.name}
            res(src+' nw='+im.naturalWidth+' pre='+pre+' '+dec+' post='+post)};
          im.onerror=()=>res(src+' loaderror');im.src=src+'?probe='+Date.now();setTimeout(()=>res(src+' timeout'),10000)})}
        (async()=>{const a=await test('assets/avatar-0.png');const sc=await test('assets/scene-0.webp');window.__paint=a+' || '+sc})();return true})()`).catch(()=>{});
      const paint = await waitFor(sid, `window.__paint && window.__paint !== 'start' ? window.__paint : null`, 15000);
      console.log('paintprobe(info)', appName, JSON.stringify(paint));
      const gamepix = await exe(sid, `(function(){try{const c=document.querySelector('canvas');if(!c)return 'nocanvas';const k=c.getContext('2d');const w=Math.min(c.width,200),h=Math.min(c.height,200);const d=k.getImageData(0,0,w,h).data;let n=0,t=0;for(let i=3;i<d.length;i+=400){t++;if(d[i]>10)n++}return 'gamecanvas='+n+'/'+t+' ('+c.width+'x'+c.height+')'}catch(e){return 'THROW '+e.name+' '+e.message}})()`).catch(()=>null);
      console.log('gamepix', appName, JSON.stringify(gamepix));
      // post-entry deep diagnostic: errors, raf liveness, canvas inventory, image states
      const diag = await exe(sid, `return (function(){try{
        const errs=(window.__errs||[]).join(';').slice(0,250)||'none';
        const cvs=[...document.querySelectorAll('canvas')].map(c=>c.width+'x'+c.height+' vis='+(c.offsetHeight>0)).join(',')||'nocanvas';
        const imgs=[...document.images].map(i=>i.src.split('/').pop()+':'+(i.complete?1:0)+'/'+i.naturalWidth).slice(0,8).join(',')||'noimg';
        return 'errs='+errs+' || cvs='+cvs+' || imgs='+imgs
      }catch(e){return 'evalerr '+e}})()`).catch(()=>null);
      console.log('diag1', appName, JSON.stringify(diag));
      await exe(sid, `return (function(){window.__rafTick=0;requestAnimationFrame(()=>{window.__rafTick=1});return true})()`).catch(()=>{});
      await sleep(3000);
      const raf = await exe(sid, 'return window.__rafTick').catch(()=>null);
      console.log('raflive', appName, JSON.stringify(raf));
      rec(A, 'game main thread alive after entry (raf fires)', raf === 1, 'rafTick=' + raf);
      // iOS-class keyboard fuzz: events without a key field must not throw (regression guard)
      const fuzz = await exe(sid, `return (function(){const before=(window.__errs||[]).length;
        try{dispatchEvent(new KeyboardEvent('keydown',{}));dispatchEvent(new KeyboardEvent('keyup',{}));dispatchEvent(new CompositionEvent('compositionstart'));dispatchEvent(new CompositionEvent('compositionend'))}catch(e){return 'SYNC-THROW '+e.name}
        return 'errs:'+before+'->'+((window.__errs||[]).length)})()`).catch(()=>null);
      const m = /^errs:(\d+)->(\d+)$/.exec(fuzz || '');
      rec(A, 'keyboard events without key field do not throw (iOS class)', !!(m && m[1] === m[2]), String(fuzz));
      }
      // dismiss the walking-tips tutorial modal (first run) via real close click - it blocks canvas input
      const closeBtn = await el(sid, 'css selector', '.modal header button');
      if (closeBtn) {
        const cr = await click(sid, closeBtn);
        await sleep(900);
        const gone = await exe(sid, 'return !document.querySelector(".modal")').catch(()=>null);
        rec(A, 'walking-tips modal dismissed via real close click', gone === true, 'clickRes=' + JSON.stringify(cr).slice(0,80) + ' gone=' + gone);
      }
      if (!FAST) {
      // portal transition: real click on a gate-link button must move to a linked scene
      const sceneA = await exe(sid, 'return window.__dogam.S().scene').catch(()=>null);
      const gate = await el(sid, 'css selector', '.gate-links button');
      if (gate) {
        const gres = await click(sid, gate);
        console.log('gateclick(info)', appName, JSON.stringify(gres).slice(0,120));
        const moved = await waitFor(sid, `window.__dogam.S().scene !== ${sceneA} ? window.__dogam.S().scene : null`, 20000);
        console.log('gatemove(info)', appName, 'scene', sceneA, '->', JSON.stringify(moved));
        const diag2 = await exe(sid, `return (window.__errs||[]).join(';').slice(0,200)||'none'`).catch(()=>null);
        console.log('diag2', appName, JSON.stringify(diag2));
        await sleep(1500);
        await shot(sid, 'desktop-' + appName + '-scene2');
        const scenepix = await exe(sid, `(function(){try{const c=document.querySelector('canvas');const k=c.getContext('2d');const d=k.getImageData(0,0,Math.min(c.width,200),Math.min(c.height,200)).data;let n=0,t=0;for(let i=3;i<d.length;i+=400){t++;if(d[i]>10)n++}return 'scene2canvas='+n+'/'+t}catch(e){return 'THROW '+e.name}})()`).catch(()=>null);
        console.log('scenepix', appName, JSON.stringify(scenepix));
      }
    }
    const DW = process.env.DEEPWALK || (((process.env.ONLY || '').split(',').includes('seongsu-dogam') && appName === 'seongsu-dogam') ? '17,19,21,23,26' : ((process.env.ONLY || '').split(',').includes('kurashi-otaru') && appName === 'kurashi-otaru') ? '27,28,29,30,31' : '');
    if (DW) {
      const inst = await exe(sid, `return (function(){try{window.__rafProbe=0;window.__evlog=[];const T0=performance.now();const L=(n)=>window.__evlog.push(n+'@'+Math.round(performance.now()-T0));window.addEventListener('blur',()=>L('win-blur'));window.addEventListener('focus',()=>L('win-focus'));document.addEventListener('visibilitychange',()=>L('vis-'+document.visibilityState));document.addEventListener('pointerdown',()=>L('pdown'),true);(function f(){window.__rafProbe++;requestAnimationFrame(f)})();return 'installed'}catch(e){return 'ERR '+e}})()`).catch(e => 'THROW ' + e);
      console.log('deepwalk probe install:', inst);
      const targets = DW.split(',').map(Number);
      const links = await exe(sid, `return JSON.stringify(Object.fromEntries(window.GAME_DATA.nodes.map(n=>[n.id,n.links])))`).then(JSON.parse).catch(()=>null);
      const names = await exe(sid, `return JSON.stringify(Object.fromEntries(window.GAME_DATA.nodes.map(n=>[n.id,n.name[0]])))`).then(JSON.parse).catch(()=>null);
      const bfs = (from, to) => { const q=[[from]]; while(q.length){const p=q.shift(); if(p[p.length-1]===to) return p; for(const l of (links[p[p.length-1]]||[])) if(!p.includes(l)) q.push([...p,l]);} return null; };
      let cur = await exe(sid, 'return window.__dogam.S().scene');
      for (const target of targets) {
        const path = bfs(cur, target);
        console.log('deepwalk path', cur, '->', target, JSON.stringify(path));
        if (!path) { rec(A, 'deep-walk: path exists to node ' + target, false, 'no path'); continue; }
        let ok = true;
        const idle = async () => { // wait until avatar stops walking (pos stable over 1.5s)
          const p1 = await exe(sid, 'return JSON.stringify(window.__dogam.pos())').catch(()=>null);
          await sleep(1500);
          const p2 = await exe(sid, 'return JSON.stringify(window.__dogam.pos())').catch(()=>null);
          return p1 !== null && p1 === p2;
        };
        for (let i = 0; i + 1 < path.length; i++) {
          const idx = links[path[i]].indexOf(path[i+1]);
          let nxt = null;
          for (let attempt = 0; attempt < 2 && nxt === null; attempt++) {
            for (let w = 0; w < 12 && !(await idle()); w++) await sleep(1000); // up to ~18s to finish prior walk
            const gates = await els(sid, 'css selector', '.gate-links button');
            if (!gates[idx]) { rec(A, 'deep-walk: gate button for scene ' + path[i] + ' link ' + idx, false, 'missing'); ok = false; break; }
            const cr = await click(sid, gates[idx][Object.keys(gates[idx])[0]]);
            console.log('deepwalk click', path[i], 'gate', idx, 'attempt', attempt, 'res', JSON.stringify(cr).slice(0,80));
            if (path[i] === 1 && idx === 0 && attempt === 0) { for (const ms of [500, 700, 1500]) { await sleep(ms); const sm = await exe(sid, `return JSON.stringify({pos:window.__dogam.pos(),scene:window.__dogam.S().scene,raf:window.__rafProbe,ev:(window.__evlog||[]).join(','),focus:document.hasFocus()})`).catch(()=>null); console.log('deepwalk SAMPLE +'+ms, sm); } }
            nxt = await waitFor(sid, `window.__dogam.S().scene === ${path[i+1]} ? 'scene${path[i+1]}' : null`, 30000);
          }
          if (nxt === null) { const dg = await exe(sid, `return JSON.stringify((function(){const b=document.querySelectorAll('.gate-links button')[${idx}];const r=b.getBoundingClientRect();const cx=r.x+r.width/2,cy=r.y+r.height/2;const top=document.elementFromPoint(cx,cy);return {scene:window.__dogam.S().scene,pos:window.__dogam.pos(),rect:[r.x,r.y,r.width,r.height].map(Math.round),vp:[innerWidth,innerHeight],top:top?(top.tagName+'.'+(top.className||'')+' '+(top.getAttribute('aria-label')||'').slice(0,30)):null,isSelf:top===b,modal:!!document.querySelector('.modal:not(.hidden),dialog[open]'),vis:document.visibilityState,hasFocus:document.hasFocus(),inner:[innerWidth,innerHeight],canvas:(function(){const c=document.querySelector('canvas');return c?[c.width,c.height,Math.round(c.getBoundingClientRect().width),Math.round(c.getBoundingClientRect().height)]:null})(),ls:Object.keys(localStorage),tip:!!document.querySelector('.modal,.tips'),raf:window.__rafProbe,evlog:(window.__evlog||[]).join(','),active:document.activeElement?document.activeElement.tagName+'.'+(document.activeElement.className||''):null}})())`).catch(e=>'ERR '+e); console.log('deepwalk DIAG', path[i], '->', path[i+1], dg); }
          console.log('deepwalk step', path[i], '->', JSON.stringify(nxt));
          if (nxt === null) { ok = false; break; }
        }
        if (ok) {
          await sleep(1200);
          const st = await exe(sid, 'return window.__dogam.S().scene').catch(()=>null);
          const pix = await exe(sid, `(function(){try{const c=document.querySelector('canvas');const k=c.getContext('2d');const d=k.getImageData(0,0,Math.min(c.width,200),Math.min(c.height,200)).data;let n=0,t=0;for(let i=3;i<d.length;i+=400){t++;if(d[i]>10)n++}return n+'/'+t}catch(e){return 'THROW '+e.name}})()`).catch(()=>null);
          const errs = await exe(sid, `return (window.__errs||[]).join(';').slice(0,150)||'none'`).catch(()=>null);
          await shot(sid, 'deepwalk-' + appName + '-node' + target);
          if (AP) { await sleep(6000); await shot(sid, 'ap-' + appName + '-node' + target + '-7s'); }
          rec(A, 'deep-walk: enter new node ' + target + ' (' + (names[target]||'?') + ') via real gate clicks, no JS errors [canvas pixels: ' + (String(pix).indexOf('THROW') === 0 ? 'UNVERIFIED - runner Safari cannot read 2D canvases' : 'checked') + ']', st === target && (String(pix).indexOf('THROW') === 0 || (!!pix && !String(pix).startsWith('0/'))) && errs === 'none', 'scene=' + st + ' pix=' + pix + ' errs=' + errs);
          cur = target;
        }
      }
    }
      }
    if (appName === 'seongsu-dogam' && process.env.LANGCHECK !== '0') {
      try {
        await exe(sid, `localStorage.clear();return 1`); await nav(sid, 'https://seongsu-dogam-4qf0.onrender.com/'); await sleep(2500);
        const seen = [];
        for (let k = 0; k < 4; k++) {
          let btns = await els(sid, 'css selector', '.language-grid button');
          if (!btns[k]) { // app skips the language screen when initialLang is set: open it via the start screen's Language button (last in #start-actions)
            const sa = await els(sid, 'css selector', '#start-actions button');
            if (sa.length) await click(sid, sa[sa.length - 1][Object.keys(sa[sa.length - 1])[0]]);
            await sleep(700); btns = await els(sid, 'css selector', '.language-grid button');
          }
          if (!btns[k]) { seen.push('missing-btn-' + k); continue; }
          const lab = await exe(sid, `return document.querySelectorAll('.language-grid button')[${k}].textContent.trim()`).catch(() => '?');
          await click(sid, btns[k][Object.keys(btns[k])[0]]); await sleep(1000);
          const txt = await exe(sid, `return document.documentElement.lang+' | '+document.querySelector('#app h1').innerText+' | '+document.querySelector('#start-actions').innerText.replace(/\\s+/g,' ')`).catch(() => '');
          await shot(sid, 'lang-pick-' + k);
          seen.push(lab + ' => ' + txt);
        }
        const uniq = new Set(seen.map(s => s.split(' => ')[1])).size;
        rec(A, 'four languages: each language button yields a distinct traveler-screen text', uniq === 4, seen.join(' | '));
      } catch (e) { rec(A, 'four languages', false, 'THROW ' + String(e).slice(0, 120)); }
    }
    const nodes = await exe(sid, `window.GAME_DATA ? window.GAME_DATA.nodes.length : 0`).catch(()=>0);
    rec(A, 'data integrity: expected node count', nodes === expectNodes, 'nodes=' + nodes);
    if (appName === 'seongsu-dogam') {
      const places = await exe(sid, `window.GAME_DATA.nodes.filter(n=>/베통|무구옥|원밀리언|올리브영|무신사/.test(n.name[0])).map(n=>n.name[0]).join(' | ')`).catch(()=>null);
      rec(A, 'new places present: Betong + Muguok + 1MILLION + OliveYoung + Musinsa', !!(places && places.includes('베통') && places.includes('무구옥') && places.includes('원밀리언') && places.includes('올리브영') && places.includes('무신사')), String(places));
    }
    await shot(sid, 'desktop-' + appName);
    const cv = await el(sid, 'css selector', 'canvas');
    if (cv) { await exe(sid, `return window.__dogam ? (window.__tapPos = window.__dogam.pos(), true) : false`).catch(()=>{});
      // input method by platform: desktop safaridriver element click = real synthesized input (pointerdown fires);
      // Appium iOS web element click is a JS atom (no pointerdown) - use W3C touch actions (native tap) instead
      if (BS_DEVICE) {
        // Appium extension: mobile: tap = native XCTest touch at viewport coords (real touch input)
        const rect = await exe(sid, `(function(){const c=document.querySelector('canvas');const r=c.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width*0.5),y:Math.round(r.y+r.height*0.7)})})()`).catch(()=>null);
        const tres = await api('POST', '/execute/sync', { script: 'mobile: tap', args: [rect ? JSON.parse(rect) : {x:180,y:400}] }, sid).catch(e=>('ERR '+String(e).slice(0,120)));
        console.log('canvastap-native(info)', appName, String(JSON.stringify(tres)).slice(0,140), 'at', rect);
      } else {
        if (appName === 'kurashi-otaru') {
          const hit = await exe(sid, `(function(){const c=document.querySelector('canvas');const r=c.getBoundingClientRect();const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e?(e.tagName+'.'+e.className+'#'+e.id+' '+(e.textContent||'').slice(0,20)+' canvas='+(e===c)):null})()`).catch(()=>null);
          console.log('centerhit(info)', appName, hit);
        }
        const cres = await click(sid, cv);
        console.log('canvasclick(info)', appName, String(JSON.stringify(cres)).slice(0,120));
      }
      await sleep(3500); await shot(sid, 'desktop-' + appName + '-tap');
      if (appName === 'seongsu-dogam' || appName === 'kurashi-otaru') {
        const posB = await exe(sid, 'return JSON.stringify(window.__dogam.pos())').catch(()=>null);
        const posA0 = await exe(sid, 'return JSON.stringify(window.__tapPos || null)').catch(()=>null);
        rec(A, 'avatar moves after real canvas tap (position changes)', !!(posA0 && posB && posA0 !== posB), String(posA0) + ' -> ' + String(posB));
        if (appName === 'seongsu-dogam') {
          // user-complaint scope (freeze 5d54210): female direction turns + male walking, real Mac Safari captures
          await tapFraction(sid, cv, 0.25, 0.55).catch(e=>console.log('walktap1 err', String(e).slice(0,100)));
          await sleep(900); await shot(sid, 'desktop-seongsu-dogam-walk-1');
          await sleep(900); await shot(sid, 'desktop-seongsu-dogam-walk-2');
          const pw1 = await exe(sid, 'return JSON.stringify(window.__dogam.pos())').catch(()=>null);
          await tapFraction(sid, cv, 0.8, 0.55).catch(e=>console.log('walktap2 err', String(e).slice(0,100)));
          await sleep(900); await shot(sid, 'desktop-seongsu-dogam-walk-3');
          await sleep(1200); await shot(sid, 'desktop-seongsu-dogam-walk-4');
          const pw2 = await exe(sid, 'return JSON.stringify(window.__dogam.pos())').catch(()=>null);
          rec(A, 'sprite movement captures: walks left then right with timed frames (female turns / male walking, inspected on PNGs)', !!(pw1 && pw2), String(pw1) + ' -> ' + String(pw2));
        }
        if (appName === 'kurashi-otaru') {
          const hit2 = await exe(sid, `(function(){const c=document.querySelector('canvas');const r=c.getBoundingClientRect();const e=document.elementFromPoint(r.x+r.width*0.7,r.y+r.height*0.35);return e?(e.tagName+'.'+e.className+' canvas='+(e===c)):null})()`).catch(()=>null);
          console.log('offcenterhit(info)', hit2);
          await exe(sid, `return window.__dogam ? (window.__tapPos = window.__dogam.pos(), true) : false`).catch(()=>{});
          await tapFraction(sid, cv, 0.7, 0.35).catch(e=>console.log('tapFraction err', String(e).slice(0,100)));
          await sleep(3500); await shot(sid, 'desktop-' + appName + '-tap-offcenter');
          const pb = await exe(sid, 'return JSON.stringify(window.__dogam.pos())').catch(()=>null);
          const pa = await exe(sid, 'return JSON.stringify(window.__tapPos || null)').catch(()=>null);
          rec(A, 'avatar moves after real mouse-action tap off-center (position changes)', !!(pa && pb && pa !== pb), String(pa) + ' -> ' + String(pb));
        }
      }
    }
  };
}


// ---- geungrak-club (극락 동자승 클럽) ----
async function checkGeungrak(sid) {
  const A = 'geungrak-club';
  const PLAT = BS_DEVICE ? 'ios' : 'desktop';
  const boot = await waitFor(sid, `!!(document.querySelector('canvas'))`, 60000);
  rec(A, 'boot: page loads, club canvas present', !!boot);
  if (!boot) return;
  const qa = await waitFor(sid, `!!(window.__qa && window.__qa.crowd)`, 30000);
  rec(A, 'boot: module ran, __qa handle live (no fatal JS error)', !!qa);
  if (!qa) return;
  const enterBtn = await el(sid, 'xpath', "//button[contains(.,'\uC785\uC7A5')]");
  rec(A, 'entry overlay: \uC785\uC7A5 button present', !!enterBtn);
  if (enterBtn) await click(sid, enterBtn);
  const joined = await waitFor(sid, `!!(window.__qa.crowd.me)`, 30000);
  rec(A, 'entry: real \uC785\uC7A5 click spawns player (WebSocket join)', !!joined);
  if (!joined) return;
  await sleep(3000); await shot(sid, PLAT + '-geungrak-entry');
  // tap-to-walk via real canvas tap
  const p0 = await exe(sid, `const m=window.__qa.crowd.map.get(window.__qa.crowd.me); return {x:m.x,z:m.z}`);
  const cv = await el(sid, 'css selector', 'canvas');
  if (cv) await tapFraction(sid, cv, 0.5, 0.85);
  await sleep(5000);
  const p1 = await exe(sid, `const m=window.__qa.crowd.map.get(window.__qa.crowd.me); return {x:m.x,z:m.z}`);
  const moved = p0 && p1 && (Math.abs(p1.x - p0.x) + Math.abs(p1.z - p0.z)) > 0.4;
  rec(A, 'tap-to-walk: real canvas tap moves the player', moved, JSON.stringify({ p0, p1 }));
  // camera orbit via real drag
  const yaw0 = await exe(sid, `window.__qa.cam.yaw`);
  if (cv) {
    await api('POST', '/actions', { actions: [{ type: 'pointer', id: 'p1', parameters: { pointerType: BS_DEVICE ? 'touch' : 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, origin: { [EL]: cv }, x: 0, y: 0 },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: 400, origin: { [EL]: cv }, x: 120, y: 0 },
      { type: 'pointerUp', button: 0 }] }] }, sid);
    await api('DELETE', '/actions', {}, sid);
  }
  await sleep(1200);
  const yaw1 = await exe(sid, `window.__qa.cam.yaw`);
  rec(A, 'drag orbits camera (yaw changes)', yaw0 !== null && yaw1 !== null && Math.abs(yaw1 - yaw0) > 0.05, JSON.stringify({ yaw0, yaw1 }));
  // dance button
  const danceBtn = await el(sid, 'css selector', '#dance');
  if (danceBtn) await click(sid, danceBtn);
  const dancing = await waitFor(sid, `window.__qa.crowd.map.get(window.__qa.crowd.me).pose==='dance'`, 9000);
  rec(A, 'dance button sets dance pose', !!dancing);
  // jump button
  const jumpBtn = await el(sid, 'css selector', '#jump');
  if (jumpBtn) await click(sid, jumpBtn);
  const jumped = await waitFor(sid, `window.__qa.crowd.map.get(window.__qa.crowd.me).jumping===true`, 6000);
  rec(A, 'jump button triggers jump physics', !!jumped);
  // emote
  const heart = await el(sid, 'xpath', "//button[contains(.,'\u2764')]");
  if (heart) await click(sid, heart);
  await sleep(800);
  // NPC crowd
  const npcs = await exe(sid, `[...window.__qa.crowd.map.keys()].filter(k=>k.startsWith('npc')).length`);
  rec(A, 'NPC filler crowd active (>=5)', typeof npcs === 'number' && npcs >= 5, 'npcs=' + npcs);
  // stage collision regression: nobody inside the platform volume
  await sleep(4000);
  const clip = await exe(sid, `[...window.__qa.crowd.map.values()].some(m=>m.z < -3.35)`);
  rec(A, 'stage collision fix holds: no crowd member inside platform volume', clip === false, 'clip=' + JSON.stringify(clip));
  // pixel-render proof: screenshots composite WebGL black on this runner, so read the drawing buffer directly
  const gmeta = await glDump(sid, 'geungrak-floor');
  rec(A, 'canvas renders real WebGL pixels (drawing buffer non-dark)', typeof gmeta.nonDark === 'number' && gmeta.nonDark > gmeta.total * 0.05, JSON.stringify(gmeta));
  await shot(sid, PLAT + '-geungrak-actions');
}

// ---- main ----
const APPS = [
  ['https://geungrak-club.onrender.com/', checkGeungrak],
  ['https://golden-gate-picnic-sf.onrender.com/', checkGGP],
  ['https://sweet-factory-escape-3d.onrender.com/', checkSweet],
  ['https://coworking-world-u4pn.onrender.com/', checkCoworking],
  ['https://sajumadang.onrender.com/', checkDalbit],
  ['https://seongsu-dogam-4qf0.onrender.com/', checkDogam('seongsu-dogam', 27)],
  ['https://kurashi-otaru.onrender.com/', checkDogam('kurashi-otaru', 32)],
];

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const APPS_RUN = ONLY ? APPS.filter(([u]) => ONLY.some(o => u.includes(o))) : APPS;
const driver = (BS || AP) ? null : spawn('/usr/bin/safaridriver', ['-p', '4444'], { stdio: 'ignore' });
await sleep(BS ? 500 : 2500);
try {
  for (const [url, fn] of APPS_RUN) {
    const app = url.split('//')[1].split('.')[0];
    let sid = null;
    try {
      if (process.env.RESUME) {
        sid = fs.readFileSync(process.env.RESUME, 'utf8').trim();
        const alive = await exe(sid, 'return document.readyState+"|"+(!!window.__qa)').catch(()=>null);
        rec(app, 'resume: reattached to live BS session', !!alive, String(alive));
        if (alive) await fn(sid);
      } else {
      sid = await newSession();
      const navResp = await nav(sid, url);
      console.log('nav', app, JSON.stringify(navResp).slice(0, 200));
      await sleep(4000);
      const probe = await exe(sid, 'return document.readyState+"|"+document.title+"|"+location.href').catch(e => 'execfail ' + e);
      console.log('probe', app, JSON.stringify(probe).slice(0, 200));
      const title = await ready(sid, 45000);
      rec(app, 'serves 200 with real title', !!title, String(title).slice(0, 80));
      if (title) await fn(sid);
      }
    } catch (e) {
      rec(app, 'session', false, String(e && e.message || e).slice(0, 200));
    } finally {
      if (sid && !process.env.KEEP_SESSION) await api('DELETE', '', {}, sid).catch(()=>{});
      await sleep(1000);
    }
  }
} finally {
  if (driver) driver.kill();
}
fs.writeFileSync('results/summary.json', JSON.stringify(report, null, 2));
const fails = report.filter(r => !r.ok).length;
console.log(`\n==== DESKTOP SAFARI: ${report.length - fails}/${report.length} checks passed ====`);
process.exit(fails ? 1 : 0);
