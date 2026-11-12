import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPanelCodex } from '../integrations/live-panel.mjs';
import { liveShutdown } from '../integrations/live-shutdown.mjs';

it('keeps a known pre-thread RPC rejection offline with sanitized feedback until Stop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'panel-startup-')), pidFile = join(directory, 'pid');
  const controls = [], snapshots = [], setup = [], bindings = new Map(), abort = new AbortController();
  const frame = { url: () => 'http://127.0.0.1:1234/live.html' };
  const api = { reactiveUserIntent: () => {}, setupStatus: v => setup.push(v), panelControlStatus: v => controls.push(v), conversationStatus: v => snapshots.push(v), configureReactive: vi.fn() };
  const page = { url: frame.url, mainFrame: () => frame, isClosed: () => false, on() {}, off() {}, exposeBinding: async (k,v) => bindings.set(k,v),
    evaluate: async (fn,arg) => { const old = globalThis.window; globalThis.window = { fischLive: api }; try { return await fn(arg); } finally { globalThis.window = old; } } };
  const provider = { close: vi.fn(), complete: vi.fn() };
  const script = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));let b='';process.stdin.on('data',c=>{b+=c;let n;while((n=b.indexOf('\\n'))>=0){const m=JSON.parse(b.slice(0,n));b=b.slice(n+1);if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');if(m.method==='thread/start')process.stdout.write(JSON.stringify({id:m.id,error:{code:-32603,message:'PRIVATE_STARTUP_CANARY'}})+'\\n');}});`;
  let settled = false;
  const running = runPanelCodex({ live: { page, base: 'http://127.0.0.1:1', token: 'fixture' }, cwd: process.cwd(), signal: abort.signal,
    reactiveProvider: provider, host: { command: process.execPath, args: ['-e',script,'--'] } });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await vi.waitFor(() => expect(controls).toContainEqual({ type: 'startup_failed', code: -32603 }));
    expect(snapshots.at(-1)).toMatchObject({ available: false, canSend: false, canCancel: false, error: 'conversation_startup_failed' });
    expect(setup.at(-1)).toEqual({ native: 'unavailable', observer: 'unavailable' });
    expect(JSON.stringify({controls,snapshots,setup})).not.toContain('PRIVATE_STARTUP_CANARY');
    const pid = Number(await readFile(pidFile, 'utf8')); expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    // Windows termination cannot run a child SIGTERM handler; verify actual process exit instead.
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' })));
    expect(provider.close).toHaveBeenCalled(); expect(provider.complete).not.toHaveBeenCalled();
    await expect(bindings.get('fischLiveConversation')({page,frame},{action:'send',generation:0,text:'no dispatch'})).rejects.toThrow('conversation_unavailable');
    await new Promise(resolve => setTimeout(resolve,50)); expect(settled).toBe(false);
  } finally { abort.abort(liveShutdown('ui')); await expect(running).resolves.toBe(1); await rm(directory,{recursive:true,force:true}); }
});
