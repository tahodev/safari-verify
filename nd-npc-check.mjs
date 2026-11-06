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
 const exa=async(sc_)=>(await wd('POST',`/session/${sid}/execute/async`,{script:sc_,args:[]})).value;
 const shot=async(name)=>{const png=await wd('GET',`/session/${sid}/screenshot`);if(png.value)writeFileSync(`results/${name}.png`,Buffer.from(png.value,'base64'))};
 const probe=`const done=arguments[arguments.length-1];const out={};const im=new Image();im.onload=()=>{out.webp=[im.naturalWidth,im.naturalHeight];try{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.drawImage(im,0,0,64,64);const d=x.getImageData(0,0,64,64).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;out.fresh_nonzero=n}catch(e){out.fresh_err=e.message}
  const gc=[...document.querySelectorAll('canvas')];out.canv=gc.map(c=>{let r={w:c.width,h:c.height,cw:c.clientWidth,ch:c.clientHeight};try{r.url=c.toDataURL().length}catch(e){r.urlerr=e.message}try{const z=c.getContext('2d');r.ctx=!!z;r.t=Object.prototype.toString.call(z)}catch(e){r.cerr=e.message}return r});
  const b=document.createElement('canvas');b.width=gc[0]?gc[0].width:10;b.height=gc[0]?gc[0].height:10;out.blankurl=b.toDataURL().length;done(JSON.stringify(out))};im.onerror=()=>{out.err='img error';done(JSON.stringify(out))};im.src='assets/scene-12.webp?x='+Date.now();`;
 const targets=[['nd',URL_,'seongsu-atlas-v1',{lang:'en',scene:12,visited:[12],character:0,tipsSeen:true,showTips:false}],['oldsd','https://seongsu-dogam.onrender.com/','seongsu-atlas-v1',{lang:'en',scene:12,visited:[12],character:0,tipsSeen:true,showTips:false}],['kurashi','https://kurashi-otaru.onrender.com/','kurashi-atlas-v1',{lang:'en',scene:3,visited:[3],character:0,tipsSeen:true,showTips:false}]];
 for(const [nm,u,key,val] of targets){
  await wd('POST',`/session/${sid}/url`,{url:u+'robots.txt'});await sleep(800);
  if(key)await ex(`localStorage.setItem('${key}',JSON.stringify(${JSON.stringify(val)}));return 1`);
  await wd('POST',`/session/${sid}/url`,{url:u});await sleep(3000);
  for(let k=0;k<2;k++){const el=await wd('POST',`/session/${sid}/element`,{using:'xpath',value:"//button[contains(normalize-space(),'Start walking')]"});const eid=el.value&&Object.values(el.value)[0];if(eid)await wd('POST',`/session/${sid}/element/${eid}/click`,{});await sleep(1500)}
  await sleep(10000);
  console.log('PROBE',nm,await exa(probe));
  await shot('nd-diag-'+nm);
 }
 await wd('DELETE',`/session/${sid}`);
}catch(e){console.log('ERR',String(e))}
driver.kill();
// rev
