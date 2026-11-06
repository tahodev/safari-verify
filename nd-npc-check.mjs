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
 const ex=async(sc_)=>(await wd('POST',`/session/${sid}/execute/sync`,{script:sc_,args:[]})).value;
 const shot=async(name)=>{const png=await wd('GET',`/session/${sid}/screenshot`);if(png.value)writeFileSync(`results/${name}.png`,Buffer.from(png.value,'base64'))};
 for(const sc of [12,13,25,26]){
  await wd('POST',`/session/${sid}/url`,{url:URL_+'npcs.js'});await sleep(800);
  await ex(`localStorage.setItem('seongsu-atlas-v1',JSON.stringify({lang:'en',scene:${sc},visited:[${sc}],character:0,tipsSeen:true,showTips:false}));return 1`);
  await wd('POST',`/session/${sid}/url`,{url:URL_});await sleep(3000);
  const el=await wd('POST',`/session/${sid}/element`,{using:'xpath',value:"//button[contains(normalize-space(),'Start walking')]"});
  console.log('START-BTN',sc,JSON.stringify(el.value).slice(0,80));
  const eid=el.value&&Object.values(el.value)[0];if(eid)await wd('POST',`/session/${sid}/element/${eid}/click`,{});
  await sleep(3500);
  console.log('SCENE',sc,await ex(`return JSON.stringify({s:window.__dogam&&__dogam.S(),stage:window.__dogam&&__dogam.stage(),pos:__dogam.pos(),act:(document.querySelector('.actions button')||{}).textContent,npcjs:typeof window.SeongsuNPCs})`));
  await shot(`nd-safari-${sc}-a`);await sleep(2500);await shot(`nd-safari-${sc}-b`);
  console.log('POS-b',sc,await ex(`return JSON.stringify(__dogam.pos())`));
  await wd('POST',`/session/${sid}/actions`,{actions:[{type:'key',id:'k',actions:[{type:'keyDown',value:'e'},{type:'keyUp',value:'e'}]}]});await sleep(1500);
  console.log('AFTER-E',sc,await ex(`let m=document.querySelector('.modal,[role=dialog]');return m?m.innerText.slice(0,160):'no-modal'`));
  await shot(`nd-safari-${sc}-E`);
 }
 await wd('DELETE',`/session/${sid}`);
}catch(e){console.log('ERR',String(e))}
driver.kill();
// rev
