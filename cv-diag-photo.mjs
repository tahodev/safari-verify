// Scoped diag: gazua-beopdang photo-card full flow on desktop Safari.
// Captures the ACTUAL thrown stack around photo composition instead of assuming
// any 2D-canvas environment defect. Hooks: window error + unhandledrejection +
// wrapped 2D methods (drawImage/fillRect/fillText/getImageData/putImageData/
// strokeRect) + canvas.getContext + canvas.toDataURL, each recording the first
// throws with stacks and rethrowing unchanged.
// Probe validated in desktop Chrome 2026-11-08: hooks installed, snap ->
// countdown -> #photoModal.open with zero captured errors (no-flow-disturbance).
// Desktop-only: iOS sim leg is stopped (repeated WDA remote-debugger wedge).
import fs from 'node:fs';
import { spawn } from 'node:child_process';

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
// teardown: delete the WD session first, then terminate OUR safaridriver with a
// bounded wait and SIGKILL escalation. No pkill (would hit unrelated sessions on a
// shared machine); no unref/forced-exit (masks failures, risks orphans).
async function stopDriver(driver) {
  if (!driver || driver.exitCode !== null || driver.signalCode !== null) return; // already exited
  const gone = new Promise(r => driver.once('exit', r));
  try { driver.kill('SIGTERM'); } catch { return; }
  const t = setTimeout(() => { try { driver.kill('SIGKILL'); } catch {} }, 3000);
  await gone;
  clearTimeout(t);
}

const HOOKS = `(()=>{
  if (window.__photoDiag) return 'already';
  window.__errs = []; window.__stacks = [];
  addEventListener('error', e => { __errs.push({ msg: String(e.message||'').slice(0,200), stack: String(e.error && e.error.stack || '').slice(0,600) }); });
  addEventListener('unhandledrejection', e => { const r = e.reason; __errs.push({ msg: 'rej:' + String(r && (r.message || r)).slice(0,200), stack: String(r && r.stack || '').slice(0,600), evt: r && r.type ? { type: r.type, targetTag: r.target && r.target.tagName, targetSrc: String(r.target && r.target.src || '').slice(0, 60), srcLen: r.target && r.target.src ? r.target.src.length : null } : null }); });
  const wrapM = (proto, ms) => { ms.forEach(m => { const og = proto[m]; if (typeof og !== 'function') return; proto[m] = function(){ try { return og.apply(this, arguments); } catch (err) { if (__stacks.length < 6) __stacks.push(m + ': ' + String(err.stack || err).slice(0,600)); throw err; } }; }); };
  wrapM(CanvasRenderingContext2D.prototype, ['drawImage','fillRect','fillText','getImageData','putImageData','strokeRect']);
  const ogc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t, o){ try { return ogc.call(this, t, o); } catch (err) { if (__stacks.length < 6) __stacks.push('getContext(' + t + '): ' + String(err.stack || err).slice(0,600)); throw err; } };
  const otd = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(){ try { const r = otd.apply(this, arguments); if (this.id === 'gl') window.__photoDiag.shot = { len: r.length, prefix: r.slice(0, 40) }; return r; } catch (err) { if (__stacks.length < 6) __stacks.push('toDataURL: ' + String(err.stack || err).slice(0,600)); throw err; } };
  // capture-phase resource error evidence (img/script/link load failures; error events capture but do not bubble)
  window.__resErr = [];
  addEventListener('error', e => { if (e && e.target && e.target !== window && __resErr.length < 10) __resErr.push({ tag: e.target.tagName, src: String(e.target.src || e.target.href || '').slice(0, 140) }); }, true);
  let c2d = 'ok';
  try { const c = document.createElement('canvas'); c.getContext('2d').fillRect(0,0,1,1); } catch (e) { c2d = 'THROW ' + String(e && e.message || e).slice(0,120); }
  window.__photoDiag = { c2d };
  return 'installed c2d=' + c2d;
})()`;

async function main() {
  const out = { app: 'gazua-beopdang', mode: 'desktop', check: 'photo-card full flow + actual stack capture' };
  const driver = spawn('/usr/bin/safaridriver', ['-p', '4444'], { stdio: 'ignore' });
  await sleep(3000);
  try {
    const sid = await newSession();
    try {
      await nav(sid, URL1);
      const boot = await waitFor(sid, `!!document.querySelector('canvas#gl')`, 60000);
      out.boot = !!boot;
      if (!boot) { console.log('diag boot TIMEOUT'); out.fatal = 'boot-timeout'; return false; }
      const joined = await waitFor(sid, `!!document.querySelector('.tag.mine')`, 30000);
      out.joined = !!joined;
      if (!joined) { console.log('diag join TIMEOUT'); out.fatal = 'join-timeout'; return false; }
      out.hooks = await exe(sid, HOOKS).catch(e => 'ERR ' + e);
      console.log('diag hooks:', out.hooks);
      await sleep(2000);
      out.canvasPre = await exe(sid, `(()=>{const c=document.querySelector('canvas#gl');if(!c)return null;let lost=null;try{const g=c.getContext('webgl2')||c.getContext('webgl');lost=g?g.isContextLost():null}catch(e){lost='ERR '+String(e&&e.message||e).slice(0,80)}return JSON.stringify({w:c.width,h:c.height,lost})})()`).catch(() => null);
      const snap = await el(sid, 'css selector', '#snapBtn');
      out.snapPresent = !!snap;
      if (!snap) { out.fatal = 'snapBtn-missing'; return false; }
      const cr = await click(sid, snap).catch(e => 'THROW ' + String(e && e.message || e).slice(0, 160));
      out.snapClick = typeof cr === 'string' ? cr : 'ok';
      const tSnap = Date.now();
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
      out.shot = await exe(sid, `window.__photoDiag && window.__photoDiag.shot || null`).catch(() => null);
      out.resErr = await exe(sid, `window.__resErr || []`).catch(() => null);
      out.canvasPost = await exe(sid, `(()=>{const c=document.querySelector('canvas#gl');if(!c)return null;let lost=null;try{const g=c.getContext('webgl2')||c.getContext('webgl');lost=g?g.isContextLost():null}catch(e){lost='ERR '+String(e&&e.message||e).slice(0,80)}return JSON.stringify({w:c.width,h:c.height,lost})})()`).catch(() => null);
      // Read-only GL probe (feeds the later repair review; measurements only, no cause
      // attribution): ?qa=1 sets preserveDrawingBuffer:true so the last presented frame
      // normally persists. Records drawing-buffer size, the ACTUAL context attributes,
      // context-lost state, whether a synchronous same-task render was possible (the
      // app loads client.js as type=module, so its renderer is normally unreachable
      // from page scope), dense RGB + alpha counts (center 64x64; a bounded 8x8 tile
      // grid across the frame only when the center is all-zero), gl.getError after each
      // readPixels, and - only when pixel content exists - the readPixels -> row-flip ->
      // opaque-2D-composite -> toDataURL fallback exercised in-page. When neither a
      // same-task render nor buffer preservation is available the readback is reported
      // as 'unavailable', never as a cause.
      out.glProbeDelayMs = Date.now() - tSnap;
      out.glProbe = await exe(sid, `(()=>{const c=document.getElementById('gl');if(!c)return 'no-canvas';const gl=c.getContext('webgl2')||c.getContext('webgl');if(!gl)return 'no-context';const t0=performance.now();const a=gl.getContextAttributes()||{};const r={preserve:!!a.preserveDrawingBuffer,lost:gl.isContextLost()};let sync=false;try{if(typeof renderer!=='undefined'&&renderer.render&&typeof scene!=='undefined'&&typeof camera!=='undefined'){renderer.render(scene,camera);sync=true;}}catch(e){r.syncRenderErr=String(e&&e.message||e).slice(0,120);}r.syncRender=sync?'same-task':'unavailable-module-scope';const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;r.dbw=w;r.dbh=h;if(!w||!h)return JSON.stringify(r);if(!sync&&!r.preserve){r.readback='unavailable: no same-task render and preserve=false - post-flow buffer not retained';r.probeMs=Math.round(performance.now()-t0);return JSON.stringify(r);}const S=64,cx=Math.max(0,(w>>1)-(S>>1)),cy=Math.max(0,(h>>1)-(S>>1));const px=new Uint8Array(S*S*4);gl.readPixels(cx,cy,S,S,gl.RGBA,gl.UNSIGNED_BYTE,px);r.errAfterCenter=gl.getError();let crgb=0,cal=0,casum=0;for(let i=0;i<px.length;i+=4){if(px[i]||px[i+1]||px[i+2])crgb++;if(px[i+3]){cal++;casum+=px[i+3];}}r.center={rgbPos:crgb,alphaPos:cal,alphaSum:casum,total:S*S};if(crgb===0&&cal===0){const T=32,G=8,tile=new Uint8Array(T*T*4);let trgb=0,tal=0,tasum=0;for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){const tx=Math.round(gx*(w-T)/(G-1)),ty=Math.round(gy*(h-T)/(G-1));gl.readPixels(tx,ty,T,T,gl.RGBA,gl.UNSIGNED_BYTE,tile);for(let i=0;i<tile.length;i+=4){if(tile[i]||tile[i+1]||tile[i+2])trgb++;if(tile[i+3]){tal++;tasum+=tile[i+3];}}}r.errAfterGrid=gl.getError();r.grid={tiles:G*G,tileSize:T,rgbPos:trgb,alphaPos:tal,alphaSum:tasum,total:G*G*T*T};}const anyContent=crgb>0||cal>0||(r.grid&&(r.grid.rgbPos>0||r.grid.alphaPos>0));if(anyContent){const row=w*4,buf=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);r.errAfterFull=gl.getError();const tmp=new Uint8Array(row);for(let t=0,b=h-1;t<b;t++,b--){tmp.set(buf.subarray(t*row,t*row+row));buf.copyWithin(t*row,b*row,b*row+row);buf.set(tmp,b*row);}const tc=document.createElement('canvas');tc.width=w;tc.height=h;const tx2=tc.getContext('2d');const im=tx2.createImageData(w,h);im.data.set(buf);tx2.putImageData(im,0,0);const oc=document.createElement('canvas');oc.width=w;oc.height=h;const ox=oc.getContext('2d');ox.fillStyle='#000';ox.fillRect(0,0,w,h);ox.drawImage(tc,0,0);const d=oc.toDataURL('image/png');r.fallbackLen=d.length;r.fallbackPrefix=d.slice(0,22);}r.probeMs=Math.round(performance.now()-t0);return JSON.stringify(r)})()`).catch(e => 'THROW ' + String(e && e.message || e).slice(0, 160));
    } finally {
      console.log('DIAG-SUMMARY', JSON.stringify(out));
      fs.writeFileSync('results/diag-gazua-photo.json', JSON.stringify(out, null, 2));
      await api('DELETE', '', undefined, sid).catch(() => {});
    }
  } finally {
    await stopDriver(driver);
  }
}

(async () => {
  let code = 0;
  try { if (await main() === false) code = 1; } catch (e) { console.error('diag-gazua-photo fatal', e); code = 1; }
  process.exit(code);
})();
