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
  const lang = await el(sid, 'xpath', `//*[@id='langRow']//button[@data-l='en']`);
  if (lang) { await click(sid, lang); await sleep(400); }
  const inp = await el(sid, 'css selector', '#nickIn');
  if (inp) { await click(sid, inp); await type(sid, inp, 'QA Safari'); }
  const go = await el(sid, 'css selector', '#go');
  if (go) await click(sid, go);
  const me = await waitFor(sid, `!!(window.__ggp && window.__ggp.chars && window.__ggp.chars.get(window.__ggp.me))`, 45000);
  rec(A, 'entry: real button clicks spawn avatar (WebSocket join)', !!me);
  if (me) {
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
  if (run && process.env.PLAYTHROUGH) { await sweetPlay(sid, A); }

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
    for (let iter = 0; iter < 40 && !solvedThis; iter++) {
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
      else if (staticCount >= 1 && Math.abs(p0[0]) > 0.7) { await key(p0[0] < 0 ? 'd' : 'a', 520); await sleep(260); } // pinned on a boundary wall: strafe to the centered doorway
      else { await key('w', 380); await sleep(340); }
      const p1 = await exe(sid, 'JSON.stringify(window.__qa.pos())').catch(()=>null);
      try { const a = JSON.parse(p1); staticCount = (Math.hypot(a[0]-p0[0], a[1]-p0[1]) < 0.05) ? staticCount + 1 : 0; } catch(e) {}
      console.log('nav room' + room, 'iter' + iter, 'pos', JSON.stringify(p0), '->', p1, 'sp', JSON.stringify(sp));
    }
    if (solvedThis) rec(A, 'playthrough: room ' + (room+1) + ' puzzle solved via real input', true);
    else allOk = false;
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
    // timer: open 타이머 menu, pick 25분 집중 -> HUD shows a running focus timer
    const tbtn = await el(sid, 'css selector', 'button[data-menu="timerMenu"]');
    if (tbtn) { await click(sid, tbtn); await sleep(600); }
    const t25 = await el(sid, 'css selector', '[data-timer="25"]');
    if (t25) { await click(sid, t25); await sleep(1200); }
    const thud = await exe(sid, `(function(){const h=document.getElementById('timerhud');return h?JSON.stringify({vis:h.style.display!=='none'&&h.offsetHeight>0,txt:h.textContent.slice(0,40)}):null})()`).catch(()=>null);
    rec(A, 'timer: 25-minute focus timer starts via real menu clicks', !!(thud && JSON.parse(thud).vis && /25분 집중|집중/.test(JSON.parse(thud).txt)), String(thud));
    // chat: type into #chatin + Enter -> message lands in #chatlog
    const ci = await el(sid, 'css selector', '#chatin');
    if (ci) { await click(sid, ci); await type(sid, ci, 'QA chat probe');
      if (BS_DEVICE) { await api('POST', '/keys', { value: ['\uE007'] }, sid).catch(()=>{}); }
      else await type(sid, ci, '\uE007');
      await sleep(1500); }
    console.log('chatdbg(info)', await exe(sid, `JSON.stringify({val:(document.getElementById('chatin')||{}).value||'',log:((document.getElementById('chatlog')||{}).textContent||'').slice(0,60)})`).catch(()=>null));
    const log = await exe(sid, `(document.getElementById('chatlog')||{}).textContent||''`).catch(()=>null);
    if (BS_DEVICE) {
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
    if (process.env.DEEPWALK) {
      const targets = process.env.DEEPWALK.split(',').map(Number);
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
            nxt = await waitFor(sid, `window.__dogam.S().scene === ${path[i+1]} ? window.__dogam.S().scene : null`, 30000);
          }
          console.log('deepwalk step', path[i], '->', JSON.stringify(nxt));
          if (nxt === null) { ok = false; break; }
        }
        if (ok) {
          await sleep(1200);
          const st = await exe(sid, 'return window.__dogam.S().scene').catch(()=>null);
          const pix = await exe(sid, `(function(){try{const c=document.querySelector('canvas');const k=c.getContext('2d');const d=k.getImageData(0,0,Math.min(c.width,200),Math.min(c.height,200)).data;let n=0,t=0;for(let i=3;i<d.length;i+=400){t++;if(d[i]>10)n++}return n+'/'+t}catch(e){return 'THROW '+e.name}})()`).catch(()=>null);
          const errs = await exe(sid, `return (window.__errs||[]).join(';').slice(0,150)||'none'`).catch(()=>null);
          await shot(sid, 'deepwalk-' + appName + '-node' + target);
          rec(A, 'deep-walk: enter new destination node ' + target + ' (' + (names[target]||'?') + ') renders', st === target && !!pix && String(pix).indexOf('THROW') !== 0 && !String(pix).startsWith('0/') && errs === 'none', 'scene=' + st + ' pix=' + pix + ' errs=' + errs);
          cur = target;
        }
      }
    }
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
        const cres = await click(sid, cv);
        console.log('canvasclick(info)', appName, String(JSON.stringify(cres)).slice(0,120));
      }
      await sleep(3500); await shot(sid, 'desktop-' + appName + '-tap');
      if (appName === 'seongsu-dogam' || appName === 'kurashi-otaru') {
        const posB = await exe(sid, 'return JSON.stringify(window.__dogam.pos())').catch(()=>null);
        const posA0 = await exe(sid, 'return JSON.stringify(window.__tapPos || null)').catch(()=>null);
        rec(A, 'avatar moves after real canvas tap (position changes)', !!(posA0 && posB && posA0 !== posB), String(posA0) + ' -> ' + String(posB));
      }
    }
  };
}

// ---- main ----
const APPS = [
  ['https://golden-gate-picnic.onrender.com/', checkGGP],
  ['https://sweet-factory-escape-3d.onrender.com/', checkSweet],
  ['https://coworking-world.onrender.com/', checkCoworking],
  ['https://sajumadang.onrender.com/', checkDalbit],
  ['https://seongsu-dogam.onrender.com/', checkDogam('seongsu-dogam', 17)],
  ['https://kurashi-otaru.onrender.com/', checkDogam('kurashi-otaru', 27)],
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
