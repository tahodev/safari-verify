// Scoped diag: gazua-beopdang photo-card full flow on desktop Safari.
// Captures the ACTUAL thrown stack around photo composition instead of assuming
// the known runner 2D-canvas environment defect. Hooks: window error +
// unhandledrejection + wrapped 2D methods (drawImage/fillRect/fillText/
// getImageData/putImageData/strokeRect) + canvas.toDataURL, each recording the
// first throws with stacks and rethrowing unchanged.
// Probe validated in desktop Chrome 2026-11-08: hooks installed, snap ->
// countdown -> #photoModal.open with zero captured errors (no-flow-disturbance).
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:4444';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('results', { recursive: true });
const URL1 = 'https://gazua-beopdang.onrender.com/?qa=1';

async function api(method, path, body, sid, timeoutMs = 25000) {
  const url = BASE + (sid ? `/session/${sid}${path}` : path);
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const t = await r.text(); let j = {};
  try { j = JSON.parse(t); } catch { console.log('WD non-JSON', method, path, r.status, t.slice(0, 200)); }
  return j.value !== undefined ? j.value : j;
}
async function newSession() {
  const v = await api('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } }, undefined, 25000);
  if (!v || !v.sessionId) throw new Error('no session: ' + JSON.stringify(v).slice(0, 300));
  await api('POST', '/window/rect', { width: 1280, height: 900 }, v.sessionId).catch(() => {});
  return v.sessionId;
}
const nav = (sid, url) => api('POST', '/url', { url }, sid);
const wrap = s => /^\s*(return|const|let|var)\b/.test(s) ? s : 'return (' + s + ');';
const exe = (sid, script, args = []) => api('POST', '/execute/sync', { script: wrap(script), args }, sid);
async function el(sid, using, value) {
  try { const v = await api('POST', '/element', { using, value }, sid); return v && v['element-6066-11e4-a52e-4f735466cecf'] ? v['element-6066-11e4-a52e-4f735466cecf'] : null; } catch { return null; }
}
const click = (sid, id) => api('POST', `/element/${id}/click`, {}, sid);
async function waitFor(sid, script, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await exe(sid, script); if (v) return v; } catch {} await sleep(800); }
  return null;
}
const shot = async (sid, name) => { const v = await api('GET', '/screenshot', null, sid).catch(() => null); if (v) fs.writeFileSync(`results/${name}.png`, Buffer.from(v, 'base64')); };

const HOOKS = `(()=>{
  if (window.__photoDiag) return 'already';
  window.__errs = []; window.__stacks = [];
  addEventListener('error', e => { __errs.push({ msg: String(e.message||'').slice(0,200), stack: String(e.error && e.error.stack || '').slice(0,600) }); });
  addEventListener('unhandledrejection', e => { __errs.push({ msg: 'rej:' + String(e.reason && (e.reason.message || e.reason)).slice(0,200), stack: String(e.reason && e.reason.stack || '').slice(0,600) }); });
  const wrapM = (proto, ms) => { ms.forEach(m => { const og = proto[m]; if (typeof og !== 'function') return; proto[m] = function(){ try { return og.apply(this, arguments); } catch (err) { if (__stacks.length < 6) __stacks.push(m + ': ' + String(err.stack || err).slice(0,600)); throw err; } }; }); };
  wrapM(CanvasRenderingContext2D.prototype, ['drawImage','fillRect','fillText','getImageData','putImageData','strokeRect']);
  const ogc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t, o){ try { return ogc.call(this, t, o); } catch (err) { if (__stacks.length < 6) __stacks.push('getContext(' + t + '): ' + String(err.stack || err).slice(0,600)); throw err; } };
  const otd = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(){ try { return otd.apply(this, arguments); } catch (err) { if (__stacks.length < 6) __stacks.push('toDataURL: ' + String(err.stack || err).slice(0,600)); throw err; } };
  let c2d = 'ok';
  try { const c = document.createElement('canvas'); c.getContext('2d').fillRect(0,0,1,1); } catch (e) { c2d = 'THROW ' + String(e && e.message || e).slice(0,120); }
  window.__photoDiag = { c2d };
  return 'installed c2d=' + c2d;
})()`;

async function main() {
  const out = { app: 'gazua-beopdang', mode: 'desktop', check: 'photo-card full flow + actual stack capture' };
  const sid = await newSession();
  try {
    await nav(sid, URL1);
    const boot = await waitFor(sid, `!!document.querySelector('canvas#gl')`, 60000);
    out.boot = !!boot;
    if (!boot) { console.log('diag boot TIMEOUT'); return; }
    const joined = await waitFor(sid, `!!document.querySelector('.tag.mine')`, 30000);
    out.joined = !!joined;
    if (!joined) { console.log('diag join TIMEOUT'); return; }
    out.hooks = await exe(sid, HOOKS).catch(e => 'ERR ' + e);
    console.log('diag hooks:', out.hooks);
    await sleep(2000);
    const snap = await el(sid, 'css selector', '#snapBtn');
    out.snapPresent = !!snap;
    if (!snap) return;
    const cr = await click(sid, snap).catch(e => 'THROW ' + String(e && e.message || e).slice(0, 160));
    out.snapClick = typeof cr === 'string' ? cr : 'ok';
    // poll countdown numerals
    const seen = [];
    for (let i = 0; i < 14; i++) {
      const t = await exe(sid, `(()=>{const cd=document.getElementById('photoCount');return cd && !cd.hidden ? cd.textContent : null})()`).catch(() => null);
      if (t && seen[seen.length - 1] !== t) seen.push(t);
      await sleep(700);
    }
    out.countdownSeen = seen;
    const cardOpen = await waitFor(sid, `document.getElementById('photoModal').classList.contains('open')`, 15000);
    out.modalOpen = !!cardOpen;
    if (cardOpen) await shot(sid, 'diag-gazua-photocard');
    out.errs = await exe(sid, `window.__errs || []`).catch(() => null);
    out.stacks = await exe(sid, `window.__stacks || []`).catch(() => null);
    out.c2d = await exe(sid, `window.__photoDiag && window.__photoDiag.c2d`).catch(() => null);
  } finally {
    console.log('DIAG-SUMMARY', JSON.stringify(out));
    fs.writeFileSync('results/diag-gazua-photo.json', JSON.stringify(out, null, 2));
    await api('DELETE', '', undefined, sid).catch(() => {});
  }
}
main().catch(e => { console.error('diag-gazua-photo fatal', e); process.exit(1); });
