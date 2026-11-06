import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
mkdirSync('results',{recursive:true});
const variants={
 base:[],
 nogpu_canvas:['defaults write com.apple.Safari WebKit2UseGPUProcessForCanvasRenderingEnabled -bool false','defaults write com.apple.Safari WebKitUseGPUProcessForCanvasRenderingEnabled -bool false'],
 nogpu_all:['defaults write com.apple.Safari WebKit2GPUProcessForDOMRenderingEnabled -bool false','defaults write com.apple.Safari WebKit2UseGPUProcessForCanvasRenderingEnabled -bool false','defaults write com.apple.Safari WebKit2UseGPUProcessForMediaEnabled -bool false','defaults write com.apple.Safari WebKit2UseGPUProcessForWebGLEnabled -bool false'],
 gui:['open -a Safari','sleep 4']
};
let port=4460;
for(const [name,cmds] of Object.entries(variants)){
 for(const c of cmds){try{execSync(c,{stdio:'ignore'})}catch(e){}}
 port++;const drv=spawn('/usr/bin/safaridriver',['-p',String(port)],{stdio:'ignore'});await sleep(2500);
 const B='http://127.0.0.1:'+port;
 const wd=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return r.json()};
 try{const s=await wd('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari'}}});const sid=s.value.sessionId;
  await wd('POST',`/session/${sid}/url`,{url:'http://localhost:8099/cv.html'});await sleep(2500);
  const t=await wd('GET',`/session/${sid}/title`);console.log('VARIANT',name,t.value);
  const png=await wd('GET',`/session/${sid}/screenshot`);if(png.value)writeFileSync(`results/cv-${name}.png`,Buffer.from(png.value,'base64'));
  await wd('DELETE',`/session/${sid}`)}catch(e){console.log('VARIANT',name,'ERR',String(e))}
 drv.kill();await sleep(1000);
}
console.log('SYS',execSync('sw_vers; system_profiler SPDisplaysDataType 2>&1 | head -12; who | head -3; safaridriver --version 2>&1; defaults read /Applications/Safari.app/Contents/Info CFBundleShortVersionString').toString());
