// Real desktop Safari verification via safaridriver (WebDriver REST).
// Uses only real element clicks and pointer actions - no synthetic JS clicks.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BASE = 'http://127.0.0.1:4444';
const EL = 'element-6066-11e4-a52e-4f735466cecf';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('results', { recursive: true });
const report = [];
function rec(app, check, ok, detail = '') {
  report.push({ app, check, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${app}] ${check}${detail ? ' :: ' + detail : ''}`);
}

async function api(method, path, body, sid) {
  const url = BASE + (sid ? `/session/${sid}${path}` : path);
  const r = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = {};
  try { j = await r.json(); } catch {}
  return j.value !== undefined ? j.value : j;
}
async function newSession() {
  const v = await api('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  if (!v || !v.sessionId) throw new Error('no session: ' + JSON.stringify(v));
  await api('POST', '/window/rect', { width: 1280, height: 900 }, v.sessionId).catch(() => {});
  return v.sessionId;
}
const nav = (sid, url) => api('POST', '/url', { url }, sid);
const exe = (sid, script, args = []) => api('POST', '/execute/sync', { script, args }, sid);
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
  while (Date.now() - t0 < ms) {
    try { const v = await exe(sid, script); if (v) return v; } catch {}
    await sleep(800);
  }
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
  const boot = await waitFor(sid, `!!(window.__ggp && document.getElementById('go'))`, 90000);
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
    const seat = await exe(sid, `(()=>{const s=window.__ggp.seats[4];return s?{x:s.x,y:s.y}:null})()`).catch(()=>null);
    if (seat) {
      const cv = await el(sid, 'css selector', '#cv');
      if (cv) {
        await tapFraction(sid, cv, seat.x, seat.y);
        await sleep(3000);
        const claimed = await exe(sid, `(()=>{const s=window.__ggp.seats[4];return !!(s&&s.by===window.__ggp.me)})()`).catch(()=>null);
        rec(A, 'canvas tap claims seat (hit-testing + WS round-trip)', !!claimed);
      }
    }
  }
  await shot(sid, 'desktop-golden-gate-picnic');
}

async function checkSweet(sid) {
  const A = 'sweet-factory-escape-3d';
  const boot = await waitFor(sid, `!!document.getElementById('startBtn')`, 90000);
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
  await shot(sid, 'desktop-sweet-factory-escape-3d');
}

async function checkCoworking(sid) {
  const A = 'coworking-world';
  const boot = await waitFor(sid, `!!document.getElementById('enter')`, 90000);
  rec(A, 'boot: entry panel present', !!boot);
  if (!boot) return;
  const inp = await el(sid, 'css selector', '#nick');
  if (inp) { await click(sid, inp); await type(sid, inp, 'QA'); }
  const b = await el(sid, 'css selector', '#enter');
  if (b) await click(sid, b);
  const me = await waitFor(sid, `(()=>{try{return !!(window.__me && window.__me())}catch(e){return false}})()`, 45000);
  rec(A, 'entry: avatar joins world (WebSocket presence)', !!me);
  await shot(sid, 'desktop-coworking-world');
}

async function checkDalbit(sid) {
  const A = 'dalbit-saju-clone';
  const boot = await waitFor(sid, `document.title && document.title.indexOf('달빛사주') >= 0 && !!document.querySelector('button')`, 90000);
  rec(A, 'boot: title + UI renders', !!boot);
  if (!boot) return;
  const fx = await waitFor(sid, `!!document.querySelector('.seasonfx')`, 15000);
  rec(A, 'extras22.js executes (lookbehind fix, seasonfx element created)', !!fx);
  const rod = await el(sid, 'css selector', 'button.rod');
  if (rod) {
    await click(sid, rod);
    await sleep(1200);
    const exp = await exe(sid, `(document.querySelector('button.rod')||{}).getAttribute ? document.querySelector('button.rod').getAttribute('aria-expanded') : null`).catch(()=>null);
    rec(A, 'accordion button click works', exp === 'true', 'aria-expanded=' + exp);
  } else rec(A, 'accordion button click works', false, 'no button.rod found');
  await shot(sid, 'desktop-dalbit-saju-clone');
}

function checkDogam(appName, expectNodes) {
  return async (sid) => {
    const A = appName;
    const boot = await waitFor(sid, `!!(document.querySelector('.language-grid') || document.querySelector('.start'))`, 90000);
    rec(A, 'boot: language/start screen renders', !!boot);
    if (!boot) return;
    const handle = await exe(sid, `typeof window.__dogam === 'object'`).catch(()=>null);
    rec(A, 'QA debug handle deployed', !!handle);
    const lang = await el(sid, 'xpath', `//div[contains(@class,'language-grid')]//button[contains(.,'English')]`);
    if (lang) { await click(sid, lang); await sleep(900); }
    const name = await el(sid, 'css selector', '#name');
    if (name) { await click(sid, name); await type(sid, name, 'QA'); }
    const begin = await el(sid, 'xpath', `//*[@id='start-actions']//button[1]`);
    if (begin) await click(sid, begin);
    const entered = await waitFor(sid, `window.__dogam && ['start','language'].indexOf(window.__dogam.stage())<0 ? window.__dogam.stage() : null`, 30000);
    rec(A, 'entry: language -> traveler -> begin via real clicks', !!entered, entered ? 'stage=' + entered : '');
    const nodes = await exe(sid, `window.GAME_DATA ? window.GAME_DATA.nodes.length : 0`).catch(()=>0);
    rec(A, 'data integrity: expected node count', nodes === expectNodes, 'nodes=' + nodes);
    if (appName === 'seongsu-dogam') {
      const places = await exe(sid, `window.GAME_DATA.nodes.filter(n=>/베통|무구옥/.test(n.name[0])).map(n=>n.name[0]).join(' | ')`).catch(()=>null);
      rec(A, 'new places present: Betong + Muguok', !!(places && places.includes('베통') && places.includes('무구옥')), String(places));
    }
    await shot(sid, 'desktop-' + appName);
    const cv = await el(sid, 'css selector', 'canvas');
    if (cv) { await tapFraction(sid, cv, 0.5, 0.7); await sleep(2000); await shot(sid, 'desktop-' + appName + '-tap'); }
  };
}

// ---- main ----
const APPS = [
  ['https://golden-gate-picnic.onrender.com/', checkGGP],
  ['https://sweet-factory-escape-3d.onrender.com/', checkSweet],
  ['https://coworking-world.onrender.com/', checkCoworking],
  ['https://dalbit-saju-clone.onrender.com/', checkDalbit],
  ['https://seongsu-dogam.onrender.com/', checkDogam('seongsu-dogam', 14)],
  ['https://kurashi-otaru.onrender.com/', checkDogam('kurashi-otaru', 27)],
];

const driver = spawn('/usr/bin/safaridriver', ['-p', '4444'], { stdio: 'ignore' });
await sleep(2500);
try {
  for (const [url, fn] of APPS) {
    const app = url.split('//')[1].split('.')[0];
    let sid = null;
    try {
      sid = await newSession();
      await nav(sid, url);
      const title = await ready(sid);
      rec(app, 'serves 200 with real title', !!title, String(title).slice(0, 80));
      if (title) await fn(sid);
    } catch (e) {
      rec(app, 'session', false, String(e && e.message || e).slice(0, 200));
    } finally {
      if (sid) await api('DELETE', '', {}, sid).catch(()=>{});
      await sleep(1000);
    }
  }
} finally {
  driver.kill();
}
fs.writeFileSync('results/summary.json', JSON.stringify(report, null, 2));
const fails = report.filter(r => !r.ok).length;
console.log(`\n==== DESKTOP SAFARI: ${report.length - fails}/${report.length} checks passed ====`);
