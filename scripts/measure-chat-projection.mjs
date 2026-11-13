import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const server=await createServer({server:{host:'127.0.0.1',port:0}}); await server.listen();
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
 const samples=[];
 for(let run=0;run<3;run++)samples.push(await page.evaluate(async()=>{
  const {mountConversation}=await import('/src/live/conversation-view.ts');
  const host=document.createElement('div');host.style='height:400px;display:flex';document.body.replaceChildren(host);
  const base={generation:1,revision:1,ownerTurn:null,available:true,canSend:true,canCancel:false,pending:false,stopping:false,waiting:false,error:''};
  const history=Array.from({length:40},(_,i)=>({id:'h'+i,turn:'old',role:'assistant',text:'History '+i+' '.repeat(20),status:'completed',truncated:false}));
  let started,first,finished,created=0,work=0;
  const view=mountConversation(host,async()=>{started=performance.now();return {status:'accepted'};});view.project({...base,messages:history});
  const list=host.querySelector('ol'), original=list.firstChild;
  const observer=new MutationObserver(records=>{for(const r of records)created += [...r.addedNodes].filter(n=>n.nodeName==='LI').length;});observer.observe(list,{childList:true,subtree:true});
  host.querySelector('textarea').value='fixture';host.querySelector('textarea').dispatchEvent(new Event('input'));host.querySelector('form').requestSubmit();
  const item={id:'a',turn:'new',role:'assistant',text:'',status:'streaming',truncated:false};
  for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,10));item.text+=' chunk';const t=performance.now();view.project({...base,revision:i+2,messages:[...history,{...item}]});work+=performance.now()-t;if(first===undefined)first=performance.now()-started;}
  view.project({...base,revision:83,messages:[...history,{...item,status:'completed'}]});finished=performance.now()-started;await Promise.resolve();
  const result={submitToFirstDomMs:first,submitToFinalDomMs:finished,projectionMs:work,createdRows:created,retainedHistoryNode:list.firstChild===original};observer.disconnect();view.dispose();return result;
 }));
 writeFileSync(process.argv[2] ?? '.runtime/chat-projection.json',JSON.stringify({kind:'synthetic browser projection; no model/network latency',samples},null,2));console.log(samples);
}finally{await browser.close();await server.close();}
