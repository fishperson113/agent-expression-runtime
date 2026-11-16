import {expect,it,vi} from 'vitest';
import {startLiveServer} from '../integrations/live-server.mjs';
const bound=(port)=>({httpServer:{address:()=>({address:'127.0.0.1',port})},listen:vi.fn(),close:vi.fn()});
it.each([true,false])('retains the safe bound server in production=%s',async production=>{
 let options;const factory=async o=>{options=o;return bound((o.preview??o.server).port);};
 const server=await startLiveServer({root:'.',production,first:0,previewServer:factory,createDevServer:factory});
 expect(options.preview??options.server).toEqual({host:'127.0.0.1',port:49152,strictPort:true});
 expect(server.close).not.toHaveBeenCalled();expect(server.listen).toHaveBeenCalledTimes(production?0:1);
});
it('retries Vite collision on distinct safe ports with a bounded budget',async()=>{
 const ports=[];await expect(startLiveServer({root:'.',first:16383,previewServer:async o=>{ports.push(o.preview.port);throw Error(`Port ${o.preview.port} is already in use`);}})).rejects.toThrow('live_port_exhausted');
 expect(ports).toHaveLength(32);expect(new Set(ports).size).toBe(32);expect(ports.every(p=>p>=49152&&p<=65535)).toBe(true);
});
it('closes failed dev servers before retrying the next port',async()=>{
 const servers=[];const result=await startLiveServer({root:'.',production:false,first:0,createDevServer:async o=>{const s=bound(o.server.port);if(!servers.length)s.listen=async()=>{throw Object.assign(Error('busy'),{code:'EADDRINUSE'});};servers.push(s);return s;}});
 expect(servers[0].close).toHaveBeenCalledOnce();expect(result).toBe(servers[1]);expect(result.close).not.toHaveBeenCalled();
});
it.each(['abort','wrong-address'])('closes newly bound server on %s',async reason=>{
 const controller=new AbortController();let server;
 await expect(startLiveServer({root:'.',first:0,signal:controller.signal,previewServer:async o=>{server=bound(reason==='wrong-address'?5060:o.preview.port);if(reason==='abort')controller.abort();return server;}})).rejects.toThrow(reason==='abort'?'live_start_cancelled':'live_bound_address_invalid');
 expect(server.close).toHaveBeenCalledOnce();
});
it('does not retry unrelated errors or start after cancellation',async()=>{
 const previewServer=vi.fn(async()=>{throw Error('bad-config');});
 await expect(startLiveServer({root:'.',previewServer})).rejects.toThrow('bad-config');expect(previewServer).toHaveBeenCalledOnce();
 const c=new AbortController();c.abort();await expect(startLiveServer({root:'.',previewServer,signal:c.signal})).rejects.toThrow('live_start_cancelled');expect(previewServer).toHaveBeenCalledOnce();
});

it('retains actual dev sockets and retries an occupied safe initial port',async()=>{
 let occupied,server;
 try{
  occupied=await startLiveServer({root:process.cwd(),production:false,first:0});
  const port=occupied.httpServer.address().port;
  server=await startLiveServer({root:process.cwd(),production:false,first:port-49152});
  const address=server.httpServer.address();expect(address.port).toBeGreaterThanOrEqual(49152);expect(address.port).toBeLessThanOrEqual(65535);expect(address.port).not.toBe(port);
  const response=await fetch(`http://127.0.0.1:${address.port}/live.html`);expect(response.ok).toBe(true);
 }finally{await server?.close();await occupied?.close();}
});


it('closes a preview instance captured before its bind rejects',async()=>{
 const failed=bound(49152);let attempts=0;
 const server=await startLiveServer({root:'.',first:0,previewServer:async options=>{
  if(attempts++===0){options.plugins[0].configurePreviewServer(failed);throw Error('Port 49152 is already in use');}
  return bound(options.preview.port);
 }});
 expect(failed.close).toHaveBeenCalledOnce();expect(server.close).not.toHaveBeenCalled();
});
it('cleans real preview collision listeners and retains the successful bound server',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'fisch-preview-'));await mkdir(join(root,'dist'));await writeFile(join(root,'dist','live.html'),'<!doctype html><title>Fixture</title>');
 const before=process.listenerCount('SIGTERM');let occupied,server;
 try{
  occupied=await startLiveServer({root,first:0});const withPreview=process.listenerCount('SIGTERM');
  const port=occupied.httpServer.address().port;
  server=await startLiveServer({root,first:port-49152});
  expect(server.httpServer.address().port).not.toBe(port);
  expect(process.listenerCount('SIGTERM')).toBe(withPreview);
  const response=await fetch(`http://127.0.0.1:${server.httpServer.address().port}/live.html`);expect(response.ok).toBe(true);
 }finally{await server?.close();await occupied?.close();await rm(root,{recursive:true,force:true});}
 expect(process.listenerCount('SIGTERM')).toBe(before);
});
