import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const URL_='https://seongsu-dogam-4qf0.onrender.com/';
const driver=spawn('/usr/bin/safaridriver',['-p','4446'],{stdio:'ignore'});await sleep(2500);
const B='http://127.0.0.1:4446';
async function wd(m,p,b){const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return r.json()}
mkdirSync('results',{recursive:true});
try{
 const s=await wd('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari'}}});const sid=s.value.sessionId;
 console.log('UA',(await wd('POST',`/session/${sid}/execute/sync`,{script:'return navigator.userAgent',args:[]})).value);
 await wd('POST',`/session/${sid}/window/rect`,{width:1100,height:860});
 for(const sc of [12,13,25,26,3]){
  await wd('POST',`/session/${sid}/url`,{url:URL_});await sleep(1500);
  await wd('POST',`/session/${sid}/execute/sync`,{script:`window.addEventListener('error',e=>{window.__errs=(window.__errs||[]).concat(e.message)});localStorage.setItem('seongsu-atlas-v1',JSON.stringify({lang:'ko',scene:${sc},visited:[${sc}],character:0,tipsSeen:true,showTips:false}));return 1`,args:[]});
  await wd('POST',`/session/${sid}/url`,{url:URL_});await sleep(3500);
  const info=(await wd('POST',`/session/${sid}/execute/sync`,{script:`return JSON.stringify({scene:window.__dogam&&__dogam.S(),npcjs:typeof window.SeongsuNPCs,scenes:window.SeongsuNPCs?Object.keys(window.SeongsuNPCs).length:0,canvas:document.querySelectorAll('canvas').length})`,args:[]})).value;
  console.log('SCENE',sc,info);
  for(const k of ['a','b']){const png=await wd('GET',`/session/${sid}/screenshot`);if(png.value)writeFileSync(`results/nd-safari-${sc}-${k}.png`,Buffer.from(png.value,'base64'));await sleep(1800)}
 }
 await wd('DELETE',`/session/${sid}`);
}catch(e){console.log('ERR',String(e))}
driver.kill();
// rev
