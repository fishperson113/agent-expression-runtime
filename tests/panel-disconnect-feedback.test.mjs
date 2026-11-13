import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPanelCodex } from '../integrations/live-panel.mjs';
import { liveShutdown } from '../integrations/live-shutdown.mjs';

it('keeps partial canonical text offline after Native disconnect until Stop, without retry', async () => {
  const directory=await mkdtemp(join(tmpdir(),'panel-disconnect-')),requests=join(directory,'requests');
  const bindings=new Map(),controls=[],snapshots=[],setup=[],abort=new AbortController();
  const frame={url:()=> 'http://127.0.0.1:1234/live.html'};
  let provider, offlineBarrierDone=false;
  const api={selectThread(){},async reactiveUserIntent(){await Promise.resolve();if(api.conversationOffline)offlineBarrierDone=true;},setupStatus:v=>setup.push(v),panelControlStatus:v=>controls.push(v),conversationStatus:v=>{if(v.error==='conversation_transport_lost'){expect(provider.close).toHaveBeenCalled();expect(api.conversationOffline).toBe(true);expect(api.conversationDocument).toBeNull();expect(offlineBarrierDone).toBe(true);}snapshots.push(v);},configureReactive:vi.fn(),activity(){},setReactiveUserBusy(){},takeReactiveRequest:()=>null};
  const page={url:frame.url,mainFrame:()=>frame,isClosed:()=>false,on(){},off(){},exposeBinding:async(k,v)=>bindings.set(k,v),evaluate:async(fn,arg)=>{const old=globalThis.window;globalThis.window={fischLive:api};try{return await fn(arg);}finally{globalThis.window=old;}}};
  provider={close:vi.fn(),complete:vi.fn()};
  const script=`const fs=require('node:fs');let b='';const emit=m=>process.stdout.write(JSON.stringify(m)+'\\n');process.stdin.on('data',c=>{b+=c;let n;while((n=b.indexOf('\\n'))>=0){const m=JSON.parse(b.slice(0,n));b=b.slice(n+1);if(m.method==='initialize')emit({id:m.id,result:{}});if(m.method==='thread/start')emit({id:m.id,result:{thread:{id:'disconnect-thread'}}});if(m.method==='mcpServer/tool/call')emit({id:m.id,error:{code:-32601,message:'fixture unsupported'}});if(m.method==='turn/start'){fs.appendFileSync(${JSON.stringify(requests)},'turn/start\\n');emit({id:m.id,result:{turn:{id:'disconnect-turn',status:'inProgress'}}});emit({method:'turn/started',params:{threadId:'disconnect-thread',turn:{id:'disconnect-turn'}}});emit({method:'item/completed',params:{threadId:'disconnect-thread',turnId:'disconnect-turn',item:{type:'userMessage',id:'user',content:[{type:'text',text:m.params.input[0].text}]}}});emit({method:'item/agentMessage/delta',params:{threadId:'disconnect-thread',turnId:'disconnect-turn',itemId:'partial',delta:'Partial canonical answer'}});setTimeout(()=>{process.stderr.write('PRIVATE_DISCONNECT_CANARY');process.exit(23)},100);}}});`;
  let settled=false;const running=runPanelCodex({live:{page,base:'http://127.0.0.1:1',token:'fixture'},cwd:process.cwd(),signal:abort.signal,reactiveProvider:provider,host:{command:process.execPath,args:['-e',script,'--']}});
  void running.then(()=>{settled=true;},()=>{settled=true;});
  try {
    await vi.waitFor(()=>expect(controls.some(v=>v.type==='ready')).toBe(true));
    await vi.waitFor(()=>expect(snapshots.at(-1)?.canSend).toBe(true));
    await bindings.get('fischLiveConversation')({page,frame},{action:'send',generation:snapshots.at(-1).generation,text:'Original user question'});
    await vi.waitFor(()=>expect(snapshots.at(-1)?.error).toBe('conversation_transport_lost'));
    expect(snapshots.at(-1)).toMatchObject({available:false,canSend:false,canCancel:false,messages:[{role:'user',text:'Original user question'},{role:'assistant',text:'Partial canonical answer',status:'unknown'}]});
    expect(JSON.stringify({snapshots,controls,setup})).not.toContain('PRIVATE_DISCONNECT_CANARY');
    expect(provider.close).toHaveBeenCalled();expect(provider.complete).not.toHaveBeenCalled();expect(setup.at(-1)).toEqual({native:'unavailable',observer:'unavailable'});expect(controls).toContainEqual({type:'offline'});
    await expect(bindings.get('fischLiveConversation')({page,frame},{action:'send',generation:snapshots.at(-1).generation,text:'must not resend'})).rejects.toThrow('conversation_unavailable');
    await new Promise(resolve=>setTimeout(resolve,50));expect(settled).toBe(false);expect(await readFile(requests,'utf8')).toBe('turn/start\n');
  } finally {abort.abort(liveShutdown('ui'));await expect(running).resolves.toBe(1);await rm(directory,{recursive:true,force:true});}
});
