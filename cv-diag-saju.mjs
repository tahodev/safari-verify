// Scoped diag: sajumadang entry + night-market pin (a78f226) on desktop Safari.
// Root cause fixed vs safari-check.mjs runner FAILs: the runner locale renders the
// ENGLISH UI, but the harness matched Korean-only button text, so the guide sheet
// stayed open and DIV.veil intercepted #sceneBtn / market-chip real clicks.
// This script is locale-agnostic (bilingual xpaths) and visibility-gates matches.
// Flow order: market/pin probe BEFORE the maru step - button.pldoor.pd-market only
// paints in the post-entry gate/yard scene (zero rect inside maru, run 42436810482).
// Desktop-only: iOS sim leg is stopped (repeated WDA remote-debugger wedge).
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BASE = 'http://127.0.0.1:4444';
const EL = 'element-6066-11e4-a52e-4f735466cecf';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('results', { recursive: true });
const URL1 = 'https://sajumadang.onrender.com/';

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
  try { const v = await api('POST', '/element', { using, value }, sid); return v && v[EL] ? v[EL] : null; } catch { return null; }
}
const click = (sid, id) => api('POST', `/element/${id}/click`, {}, sid);
const type = (sid, id, text) => api('POST', `/element/${id}/value`, { text }, sid);
async function waitFor(sid, script, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await exe(sid, script); if (v) return v; } catch {} await sleep(800); }
  return null;
}
const shot = async (sid, name) => { const v = await api('GET', '/screenshot', null, sid).catch(() => null); if (v) fs.writeFileSync(`results/${name}.png`, Buffer.from(v, 'base64')); };
// visibility-gated xpath find: returns a WebDriver element only if the match paints
async function visEl(sid, xp) {
  const ok = await exe(sid, `(()=>{const r=document.evaluate(${JSON.stringify(xp)},document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null);const n=r.singleNodeValue;return !!(n&&n.offsetHeight>0)})()`).catch(() => false);
  if (!ok) return null;
  return el(sid, 'xpath', xp);
}
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

const XP_NAME_GO = `//button[contains(.,'이름 짓고 들어가기') or contains(.,'Pick a name and enter')]`;
const XP_NICK_GO = `//button[contains(.,'이 모습으로 들어가기') or contains(.,'Enter with this look')]`;
const XP_CLOSE = `//button[contains(.,'닫기') or contains(.,'Close')]`;

async function main() {
  const out = { app: 'sajumadang', mode: 'desktop' };
  const driver = spawn('/usr/bin/safaridriver', ['-p', '4444'], { stdio: 'ignore' });
  await sleep(3000);
  try {
    const sid = await newSession();
    try {
      await nav(sid, URL1);
      const boot = await waitFor(sid, `document.title && /사주마당|sajumadang|Sajumadang/i.test(document.title) && !!document.querySelector('button')`, 60000);
      out.boot = !!boot;
      console.log('diag boot:', !!boot);
      if (!boot) { out.fatal = 'boot-timeout'; return false; }
      // first-visit entry: name flow FIRST (its opener lives inside the guide sheet), else close guide
      const nameGo = await visEl(sid, XP_NAME_GO);
      out.entryPath = nameGo ? 'nameflow' : 'close-or-returning';
      if (nameGo) {
        console.log('diag entry: name flow'); await click(sid, nameGo); await sleep(800);
        const nickIn = await el(sid, 'css selector', '#fNick');
        if (nickIn) { await click(sid, nickIn); await type(sid, nickIn, 'QA마당'); }
        const nickGo = await visEl(sid, XP_NICK_GO);
        if (nickGo) { await click(sid, nickGo); await sleep(2000); }
        out.named = !!(await exe(sid, `!!document.getElementById('sayInput')`).catch(() => null));
      } else {
        const gc = await visEl(sid, XP_CLOSE);
        if (gc) { await click(sid, gc); await sleep(800); }
      }
      // yard -> night market via the market door chip FIRST: pd-market only paints in
      // the post-entry gate/yard scene (zero rect inside maru - run 42436810482)
      const door = await el(sid, 'css selector', 'button.pldoor.pd-market');
      out.doorPresent = !!door;
      if (door) {
        out.doorHitPre = await exe(sid, `(()=>{const c=document.querySelector('button.pldoor.pd-market');const r=c.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return JSON.stringify({rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],self:t===c,top:t?t.tagName+'.'+String(t.className||'').slice(0,40):null})})()`).catch(() => null);
        const cr = await click(sid, door).catch(e => 'THROW ' + String(e && e.message || e).slice(0, 160));
        out.doorClick = typeof cr === 'string' ? cr : 'ok';
        await sleep(3000);
        const pin = await exe(sid, `(()=>{const p=document.querySelector('button.plpin'),h=document.querySelector('.plhere');if(!p||!h)return JSON.stringify({pin:!!p,here:!!h});const pr=p.getBoundingClientRect(),hr=h.getBoundingClientRect();const overlap=!(pr.right<hr.left||pr.left>hr.right||pr.bottom<hr.top||pr.top>hr.bottom);const zp=getComputedStyle(p).zIndex,zh=getComputedStyle(h).zIndex;const fs=+getComputedStyle(p).fontSize.replace('px','');const el=document.elementFromPoint(pr.left+pr.width/2,pr.top+pr.height/2);const hit=el===p||p.contains(el);return JSON.stringify({pin:true,here:true,overlap,zp,zh,hit,pinText:p.textContent.trim().slice(0,30),pinVisible:p.offsetHeight>0&&p.offsetWidth>0,fs})})()`).catch(() => null);
        out.pin = pin ? JSON.parse(pin) : null;
        out.pinFixA78f226 = !!(out.pin && out.pin.pin && out.pin.here && out.pin.hit === true && +out.pin.zp > +out.pin.zh && out.pin.pinVisible && out.pin.pinText.length > 0 && out.pin.fs >= 10);
      }
      await shot(sid, 'diag-saju-playpin');
      // gate -> maru AFTER the market probe (best-effort; verdict already accepted in run 42436810482)
      const sb = await el(sid, 'css selector', '#sceneBtn');
      if (sb) {
        const cr = await click(sid, sb).catch(e => 'THROW ' + String(e && e.message || e).slice(0, 160));
        out.sceneBtnClick = typeof cr === 'string' ? cr : 'ok';
        const inMaru = await waitFor(sid, `document.getElementById('stage').classList.contains('scene-maru')`, 25000);
        out.gateToMaru = !!inMaru;
        const ph = await exe(sid, `(document.getElementById('sayInput')||{}).placeholder || ''`).catch(() => null);
        out.maruPlaceholder = String(ph);
      } else out.sceneBtnClick = 'no #sceneBtn';
      await shot(sid, 'diag-saju-maru');
    } finally {
      console.log('DIAG-SUMMARY', JSON.stringify(out));
      fs.writeFileSync('results/diag-saju.json', JSON.stringify(out, null, 2));
      await api('DELETE', '', undefined, sid).catch(() => {});
    }
  } finally {
    await stopDriver(driver);
  }
}

(async () => {
  let code = 0;
  try { if (await main() === false) code = 1; } catch (e) { console.error('diag-saju fatal', e); code = 1; }
  process.exit(code);
})();
