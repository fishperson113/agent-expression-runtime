import {lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {desktopRuntimePaths} from './desktop-runtime.mjs';
export function visualPreferenceFile() {
  try{return join(desktopRuntimePaths().parent,'visual-preferences.json');}catch{return undefined;}
}
const quality=value=>value===2000||value===8000;
function safeFile(file) {
  try {const stat=lstatSync(file);return stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=128;}
  catch(error){if(error.code==='ENOENT')return true;throw error;}
}
export function loadVisualPreference(file=visualPreferenceFile()) {
  try {
    const parent=lstatSync(dirname(file));
    if(!parent.isDirectory()||parent.isSymbolicLink()||!safeFile(file))return 2000;
    const value=JSON.parse(readFileSync(file,'utf8'));
    return value?.schemaVersion===1&&Object.keys(value).sort().join() === 'particles,schemaVersion'&&quality(value.particles)?value.particles:2000;
  }catch{return 2000;}
}
export function saveVisualPreference(value,file=visualPreferenceFile()) {
  if(!quality(value))return false;
  let temp;
  try {
    mkdirSync(dirname(file),{recursive:true});const parent=lstatSync(dirname(file));
    if(!parent.isDirectory()||parent.isSymbolicLink()||!safeFile(file))return false;
    temp=file+'.'+randomUUID()+'.tmp';
    writeFileSync(temp,JSON.stringify({schemaVersion:1,particles:value}),{encoding:'utf8',flag:'wx',mode:0o600});
    renameSync(temp,file);temp=undefined;return true;
  }catch{return false;}finally{if(temp)try{unlinkSync(temp);}catch{}}
}
export async function bindVisualPreferences(page,origin,{file=visualPreferenceFile()}={}) {
  const frame=page.mainFrame();
  await page.exposeBinding('fischSaveVisualQuality',(source,value)=>{
    try {
      const url=new URL(frame.url());
      if(source.page!==page||source.frame!==frame||page.isClosed()||url.origin!==origin||url.pathname!=='/live.html')return false;
      return saveVisualPreference(value,file);
    }catch{return false;}
  });
  await page.addInitScript(({origin,value})=>{
    if(location.origin!==origin||location.pathname!=='/live.html')return;
    try {if(localStorage.getItem('fisch.visual-quality')===null)localStorage.setItem('fisch.visual-quality',String(value));}catch{}
  },{origin,value:loadVisualPreference(file)});
}
