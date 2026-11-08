// Narrow read-only tap diagnostics for dogam-engine apps (seongsu-dogam, ghibli-travel).
// Goal: distinguish (a) app rAF loop dead (draw() throw) from (b) tap path no-op
// (walkable-polygon / elementFromPoint interception) from (c) rAF throttling.
// Method: wrap 2D-context draw methods AFTER load to count calls and capture throw
// stacks live; a separately installed rAF counter proves the global rAF still ticks.
// Real input only: W3C pointer tap at canvas center + W3C key actions (w key).
// iOS leg (AP=1) is the positive control: iOS sim Safari paints 2D fine.
import fs from 'node:fs';

const AP = process.env.AP === '1';
const BASE = AP ? 'http://127.0.0.1:4723' : 'http://127.0.0.1:4444';
const EL = 'element-6066-11e4-a52e-4f735466cecf';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('results', { recursive: true });

const APPS = {
  'seongsu-dogam': 'https://seongsu-dogam-4qf0.onrender.com/',
  'ghibli-travel': 'https://ghibli-travel.onrender.com/',
};
const ONLY = (process.env.ONLY || 'seongsu-dogam,ghibli-travel').split(',');

async function api(method, path, body, sid, timeoutMs = 25000) {
  const url = BASE + (sid ? `/session/${sid}${path}` : path);
  if (AP) {
    const http = await import('node:http');
    const txt = await new Promise((resolve, reject) => {
      const rq = http.request(url, { method, headers: { 'content-type': 'application/json' }, timeout: timeoutMs }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
      rq.on('timeout', () => { rq.destroy(new Error('http timeout ' + timeoutMs)); });
      rq.on('error', reject);
      if (body) rq.write(JSON.stringify(body)); rq.end();
    });
    let j = {}; try { j = JSON.parse(txt); } catch { console.log('WD non-JSON', method, path, txt.slice(0, 200)); }
    return j.value !== undefined ? j.value : j;
  }
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const t = await r.text(); let j = {};
  try { j = JSON.parse(t); } catch { console.log('WD non-JSON', method, path, r.status, t.slice(0, 200)); }
  return j.value !== undefined ? j.value : j;
}
async function newSession() {
  const caps = AP
    ? { capabilities: { alwaysMatch: { platformName: 'iOS', browserName: 'Safari',
        'appium:automationName': 'XCUITest', 'appium:udid': process.env.SIM_UDID, 'appium:deviceName': process.env.SIM_NAME || 'iPhone',
        'appium:platformVersion': process.env.SIM_OS, 'appium:newCommandTimeout': 300, 'appium:wdaLaunchTimeout': 420000,
        'appium:wdaConnectionTimeout': 420000, 'appium:wdaStartupRetries': 1, 'appium:noReset': true } } }
    : { capabilities: { alwaysMatch: { browserName: 'safari' } } };
  const v = await api('POST', '/session', caps, undefined, AP ? 600000 : 25000);
  if (!v || !v.sessionId) throw new Error('no session: ' + JSON.stringify(v).slice(0, 300));
  if (!AP) await api('POST', '/window/rect', { width: 1280, height: 900 }, v.sessionId).catch(() => {});
  return v.sessionId;
}
const nav = (sid, url) => api('POST', '/url', { url }, sid);
const wrap = s => /^\s*(return|const|let|var)\b/.test(s) ? s : 'return (' + s + ');';
const exe = (sid, script, args = []) => api('POST', '/execute/sync', { script: wrap(script), args }, sid);
async function el(sid, using, value) {
  try { const v = await api('POST', '/element', { using, value }, sid); return v && v[EL] ? v[EL] : null; } catch { return null; }
}
async function waitFor(sid, script, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await exe(sid, script); if (v) return v; } catch {} await sleep(800); }
  return null;
}
const shot = async (sid, name) => { const v = await api('GET', '/screenshot', null, sid).catch(() => null); if (v) fs.writeFileSync(`results/${name}.png`, Buffer.from(v, 'base64')); };

const INSTALL = `(()=>{
  if (window.__diag) return 'already';
  const d = window.__diag = { err: [], drawCalls: 0, drawThrow: [], raf: 0, t0: Date.now() };
  addEventListener('error', e => { d.err.push(String(e.message||'').slice(0,200) + ' @ ' + String(e.filename||'') + ':' + (e.lineno||'') + (e.error && e.error.stack ? ' | ' + String(e.error.stack).slice(0,400) : '')); });
  addEventListener('unhandledrejection', e => { d.err.push('rejection: ' + String(e.reason && (e.reason.stack || e.reason.message) || e.reason).slice(0,400)); });
  const oRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => oRaf(t => { d.raf++; return cb(t); });
  for (const m of ['drawImage','fill','fillRect','clearRect','strokeRect','putImageData']) {
    const orig = CanvasRenderingContext2D.prototype[m];
    if (!orig || orig.__diagWrapped) continue;
    const w = function(...a){ d.drawCalls++; try { return orig.apply(this, a); } catch (e) { d.drawThrow.push(m + ': ' + String(e.message||e).slice(0,200) + ' | ' + String(e.stack||'').slice(0,400)); throw e; } };
    w.__diagWrapped = 1;
    CanvasRenderingContext2D.prototype[m] = w;
  }
  return 'installed';
})()`;

const SAMPLE = `JSON.stringify((()=>{
  const d = window.__diag || {};
  return {
    pos: window.__dogam && window.__dogam.pos ? window.__dogam.pos() : null,
    stage: window.__dogam && window.__dogam.stage ? window.__dogam.stage() : null,
    scene: window.__dogam && window.__dogam.S ? window.__dogam.S().scene : null,
    raf: d.raf ?? null, drawCalls: d.drawCalls ?? null,
    errN: (d.err||[]).length, err: (d.err||[]).slice(-3),
    drawThrowN: (d.drawThrow||[]).length, drawThrow: (d.drawThrow||[]).slice(-3),
    ms: Date.now() - (d.t0 || Date.now())
  };
})())`;

async function keyHold(sid, key, holdMs) {
  await api('POST', '/actions', { actions: [{ type: 'key', id: 'k1', actions: [
    { type: 'keyDown', value: key }, { type: 'pause', duration: holdMs }, { type: 'keyUp', value: key }] }] }, sid);
  await api('DELETE', '/actions', {}, sid);
}

async function diagApp(sid, app, url) {
  console.log('=== DIAG', app, url, AP ? '(iOS-sim positive control)' : '(desktop)') ;
  await nav(sid, url);
  const boot = await waitFor(sid, `document.readyState==='complete' && window.__dogam ? document.title : null`, 90000);
  console.log('diag boot:', boot || 'TIMEOUT');
  if (!boot) return;
  await sleep(3000); // let the entry screen settle; do NOT enter — engine loop runs behind start
  console.log('diag install:', await exe(sid, INSTALL).catch(e => 'ERR ' + e));
  // enter the game if a start gate is up (real button click), else proceed
  const gate = await el(sid, 'css selector', '#go, .gate-links button, #startBtn, button');
  const st0 = JSON.parse(await exe(sid, SAMPLE).catch(() => '{}') || '{}');
  console.log('diag pre-enter stage:', st0.stage, 'scene:', st0.scene);
  if (st0.stage && st0.stage !== 'game' && gate) {
    await api('POST', `/element/${gate}/click`, {}, sid).catch(() => {});
    await sleep(2500);
  }
  const sBase = JSON.parse(await exe(sid, SAMPLE).catch(() => '{}') || '{}');
  console.log('diag baseline:', JSON.stringify(sBase));
  await sleep(2000);
  const sBase2 = JSON.parse(await exe(sid, SAMPLE).catch(() => '{}') || '{}');
  console.log('diag baseline+2s: rafDelta=', (sBase2.raf ?? 0) - (sBase.raf ?? 0), 'drawCallsDelta=', (sBase2.drawCalls ?? 0) - (sBase.drawCalls ?? 0), 'posSame=', JSON.stringify(sBase2.pos) === JSON.stringify(sBase.pos));
  // what receives the tap at canvas center?
  const hit = await exe(sid, `JSON.stringify((()=>{const c=document.querySelector('canvas');const r=c?c.getBoundingClientRect():{left:0,top:0,width:innerWidth,height:innerHeight};const cx=r.left+r.width/2, cy=r.top+r.height/2;const e=document.elementFromPoint(cx,cy);return {cx:Math.round(cx),cy:Math.round(cy),top:e?e.tagName+'.'+(e.className||''):null, isCanvas:e===c, path:(()=>{const p=[];let n=e;while(n&&p.length<5){p.push(n.tagName+(n.className?'.'+String(n.className).slice(0,30):''));n=n.parentElement}return p})()}})())`).catch(() => null);
  console.log('diag elementFromPoint:', hit);
  // real pointer tap at canvas center
  const cv = await el(sid, 'css selector', 'canvas');
  if (cv) {
    await api('POST', '/actions', { actions: [{ type: 'pointer', id: 'p1', parameters: { pointerType: AP ? 'touch' : 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, origin: { [EL]: cv }, x: 0, y: 0 },
      { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 100 }, { type: 'pointerUp', button: 0 }] }] }, sid);
    await api('DELETE', '/actions', {}, sid);
  } else console.log('diag: no canvas element found');
  for (const ms of [500, 500, 1000, 2000]) {
    await sleep(ms);
    const s = JSON.parse(await exe(sid, SAMPLE).catch(() => '{}') || '{}');
    console.log('diag post-tap:', JSON.stringify(s));
  }
  await shot(sid, `diag-${app}-post-tap`);
  // keyboard real-input movement check (w = up, 700ms hold)
  await keyHold(sid, 'w', 700);
  for (const ms of [500, 700, 1000]) {
    await sleep(ms);
    const s = JSON.parse(await exe(sid, SAMPLE).catch(() => '{}') || '{}');
    console.log('diag post-key:', JSON.stringify(s));
  }
  await shot(sid, `diag-${app}-post-key`);
  const fin = JSON.parse(await exe(sid, SAMPLE).catch(() => '{}') || '{}');
  console.log('DIAG-SUMMARY', JSON.stringify({ app, mode: AP ? 'ios-sim' : 'desktop', baseline: sBase, final: fin, elementFromPoint: hit ? JSON.parse(hit) : null }));
}

const sid = await newSession();
try {
  for (const app of ONLY) if (APPS[app]) await diagApp(sid, app, APPS[app]);
} finally {
  await api('DELETE', '', {}, sid).catch(() => {});
}
console.log('diag done');
