// Real desktop Safari verification via safaridriver (WebDriver REST).
// Uses only real element clicks and pointer actions - no synthetic JS clicks.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BS = process.env.BS === '1';
const BS_DEVICE = process.env.BS_DEVICE || null; // e.g. 'iPhone 15 Pro' for real-mobile session
const BASE = BS ? 'https://hub-cloud.browserstack.com/wd/hub' : 'http://127.0.0.1:4444';
const BS_AUTH = BS ? 'Basic ' + Buffer.from(process.env.BS_CREDS + ':').toString('base64') : null;
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
    headers: { 'content-type': 'application/json', ...(BS_AUTH ? { authorization: BS_AUTH } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch { console.log('WD non-JSON', method, path, r.status, t.slice(0, 200)); }
  if (j && j.value && j.value.error) console.log('WD error', method, path, JSON.stringify(j.value).slice(0, 300));
  return j.value !== undefined ? j.value : j;
}
async function newSession() {
  let caps;
  if (BS && BS_DEVICE) {
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
  const v = await api('POST', '/session', caps);
  if (!v || !v.sessionId) throw new Error('no session: ' + JSON.stringify(v));
  if (!BS_DEVICE) await api('POST', '/window/rect', { width: 1280, height: 900 }, v.sessionId).catch(() => {});
  return v.sessionId;
}
const nav = (sid, url) => api('POST', '/url', { url }, sid);
const wrap = s => /^\s*(return|const|let|var)\b/.test(s) ? s : 'return (' + s + ');';
const exe = (sid, script, args = []) => api('POST', '/execute/sync', { script: wrap(script), args }, sid);
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
    const seatF = await exe(sid, `(()=>{const s=window.__ggp.seats[4];const c=document.getElementById('cv');return s&&c&&c.width?{fx:s.x/c.width,fy:s.y/c.height}:null})()`).catch(()=>null);
    if (!seatF) rec(A, 'canvas tap claims seat (hit-testing + WS round-trip)', false, 'no seats[4] coords from __ggp');
    if (seatF) {
      const cv = await el(sid, 'css selector', '#cv');
      if (cv) {
        await tapFraction(sid, cv, seatF.fx, seatF.fy);
        await sleep(3000);
        const claimed = await exe(sid, `(()=>{const c=window.__ggp.chars.get(window.__ggp.me);return !!(c&&c.seat!=null)})()`).catch(()=>null);
        rec(A, 'canvas tap claims seat (hit-testing + WS round-trip)', !!claimed);
      } else rec(A, 'canvas tap claims seat (hit-testing + WS round-trip)', false, 'no #cv canvas element');
    }
  }
  await shot(sid, 'desktop-golden-gate-picnic');
}

async function checkSweet(sid) {
  const A = 'sweet-factory-escape-3d';
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
  await shot(sid, 'desktop-sweet-factory-escape-3d');
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
    rec(A, 'chat placeholder switches to 마루 in maru scene', !!(ph && ph.indexOf('마루') >= 0), String(ph));
  } else rec(A, 'gate->maru entry via real button click (scene switches)', false, 'no #sceneBtn found');
  await shot(sid, 'desktop-' + A);
}

function checkDogam(appName, expectNodes) {
  return async (sid) => {
    const A = appName;
    const boot = await waitFor(sid, `!!(document.querySelector('.language-grid') || document.querySelector('.start'))`, 60000);
    rec(A, 'boot: language/start screen renders', !!boot);
    if (!boot) return;
    const handle = await exe(sid, `typeof window.__dogam === 'object'`).catch(()=>null);
    rec(A, 'QA debug handle deployed', !!handle);
    await exe(sid, `(()=>{window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message)+' @ '+(e.filename||'').split('/').pop()+':'+(e.lineno||'')+':'+(e.colno||'')+' STACK:'+String(e.error&&e.error.stack||'').slice(0,400)));addEventListener('unhandledrejection',e=>window.__errs.push('REJECT: '+String(e.reason&&e.reason.stack||e.reason).slice(0,300)));return true})()`).catch(()=>{});
    const lang = await el(sid, 'xpath', `//div[contains(@class,'language-grid')]//button[contains(.,'English')]`);
    if (lang) { await click(sid, lang); }
    for (const wait of [300, 1200, 2500]) {
      await sleep(wait);
      const snap = await exe(sid, `(function(){try{return (document.querySelectorAll('.travelers button').length)+'btns stage='+(window.__dogam?window.__dogam.stage():'?')+' errs='+((window.__errs||[]).join(';').slice(0,220)||'none')}catch(e){return 'evalerr '+e}})()`).catch(()=>null);
      console.log('probe@' + wait, appName, JSON.stringify(snap));
    }
    await sleep(1500);
    const counts = await exe(sid, `(function(){try{const t=document.querySelector('.travelers');const b=document.querySelector('.travelers button');return (document.querySelectorAll('.travelers button').length)+'/'+(document.querySelectorAll('#start-actions button').length)+' grid='+(!!t)+' vis='+(b?b.offsetHeight:'-')+' ua='+navigator.userAgent.slice(0,60)}catch(e){return 'evalerr '+e}})()`).catch(()=>null);
    rec(A, 'traveler grid + begin button render after language pick', !!(counts && counts.indexOf('10/') === 0), String(counts));
    const btnpix = await exe(sid, `(function(){try{const c=document.querySelector('.travelers button canvas');if(!c)return 'nocanvas';const k=c.getContext('2d');const d=k.getImageData(0,0,c.width,c.height).data;let n=0,t=0;for(let i=3;i<d.length;i+=40){t++;if(d[i]>10)n++}return 'btncanvas='+n+'/'+t+' ('+c.width+'x'+c.height+')'}catch(e){return 'THROW '+e.name+' '+e.message}})()`).catch(()=>null);
    console.log('btnpix', appName, JSON.stringify(btnpix));
    rec(A, 'traveler sprite canvas actually painted (pixels)', !!(btnpix && !String(btnpix).startsWith('btncanvas=0/') && !String(btnpix).startsWith('THROW') && btnpix !== 'nocanvas'), String(btnpix));
    await shot(sid, 'desktop-' + appName + '-start');
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
      // portal transition: real click on a gate-link button must move to a linked scene
      const sceneA = await exe(sid, 'return window.__dogam.S().scene').catch(()=>null);
      const posA = await exe(sid, 'return JSON.stringify(window.__dogam.pos())').catch(()=>null);
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
    const nodes = await exe(sid, `window.GAME_DATA ? window.GAME_DATA.nodes.length : 0`).catch(()=>0);
    rec(A, 'data integrity: expected node count', nodes === expectNodes, 'nodes=' + nodes);
    if (appName === 'seongsu-dogam') {
      const places = await exe(sid, `window.GAME_DATA.nodes.filter(n=>/베통|무구옥|원밀리언|올리브영|무신사/.test(n.name[0])).map(n=>n.name[0]).join(' | ')`).catch(()=>null);
      rec(A, 'new places present: Betong + Muguok + 1MILLION + OliveYoung + Musinsa', !!(places && places.includes('베통') && places.includes('무구옥') && places.includes('원밀리언') && places.includes('올리브영') && places.includes('무신사')), String(places));
    }
    await shot(sid, 'desktop-' + appName);
    const cv = await el(sid, 'css selector', 'canvas');
    if (cv) { await tapFraction(sid, cv, 0.5, 0.7); await sleep(3500); await shot(sid, 'desktop-' + appName + '-tap');
      const posB = await exe(sid, 'return JSON.stringify(window.__dogam.pos())').catch(()=>null);
      rec(A, 'avatar moves after real canvas tap (position changes)', !!(posA && posB && posA !== posB), String(posA) + ' -> ' + String(posB));
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
const driver = BS ? null : spawn('/usr/bin/safaridriver', ['-p', '4444'], { stdio: 'ignore' });
await sleep(BS ? 500 : 2500);
try {
  for (const [url, fn] of APPS_RUN) {
    const app = url.split('//')[1].split('.')[0];
    let sid = null;
    try {
      sid = await newSession();
      const navResp = await nav(sid, url);
      console.log('nav', app, JSON.stringify(navResp).slice(0, 200));
      await sleep(4000);
      const probe = await exe(sid, 'return document.readyState+"|"+document.title+"|"+location.href').catch(e => 'execfail ' + e);
      console.log('probe', app, JSON.stringify(probe).slice(0, 200));
      const title = await ready(sid, 45000);
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
  if (driver) driver.kill();
}
fs.writeFileSync('results/summary.json', JSON.stringify(report, null, 2));
const fails = report.filter(r => !r.ok).length;
console.log(`\n==== DESKTOP SAFARI: ${report.length - fails}/${report.length} checks passed ====`);
process.exit(fails ? 1 : 0);
