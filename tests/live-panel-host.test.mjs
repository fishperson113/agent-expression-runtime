import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLiveOptions } from '../bin/fisch.mjs';
import { runPanelCodex } from '../integrations/live-panel.mjs';

function panelPage() {
  const bindings = new Map(), controls = [], snapshots = [];
  const frame = { url: () => 'http://127.0.0.1:1234/live.html' };
  const api = { selectThread: () => {}, setupStatus: () => {}, panelControlStatus: value => controls.push(value),
    conversationStatus: value => snapshots.push(value), activity: () => {}, configureReactive: () => {}, setReactiveUserBusy: () => {},
    reactiveUserIntent: () => {}, takeReactiveRequest: () => null };
  const page = { url: frame.url, mainFrame: () => frame, isClosed: () => false, on: () => {}, off: () => {},
    exposeBinding: async (name, callback) => bindings.set(name, callback),
    evaluate: async (fn, arg) => { if (String(fn).includes('panelControlStatus')) await new Promise(resolve => setTimeout(resolve, 2)); const old = globalThis.window; globalThis.window = { fischLive: api };
      try { return await fn(arg); } finally { globalThis.window = old; } } };
  return { bindings, controls, snapshots, page, frame };
}
it('boots a selected panel thread and submits browser text through the same canonical transport without a terminal', async () => {
  const script = `let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const m=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'panel-thread'}}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'panel-turn',status:'inProgress'}}});send({method:'turn/started',params:{threadId:'panel-thread',turn:{id:'panel-turn'}}});for(let i=0;i<8;i++)send({method:'item/started',params:{threadId:'panel-thread',turnId:'panel-turn',item:{id:'tool-'+i,type:'mcpToolCall',server:'fisch_live',tool:'observe',status:'inProgress'}}});send({method:'item/agentMessage/delta',params:{threadId:'panel-thread',turnId:'panel-turn',itemId:'answer',delta:'Canonical fixture reply'}});send({method:'turn/completed',params:{threadId:'panel-thread',turn:{id:'panel-turn',status:'completed'}}});}}});`;
  const { bindings, controls, snapshots, page, frame } = panelPage(), abort = new AbortController();
  const run = runPanelCodex({ live: { page, base: 'http://127.0.0.1:1', token: 'fixture' }, cwd: process.cwd(),
    signal: abort.signal, reactiveProvider: null, host: { command: process.execPath, args: ['-e', script, '--'] } });
  try {
    await vi.waitFor(() => expect(controls.some(value => value.type === 'ready' && value.threadId === 'panel-thread')).toBe(true));
    await vi.waitFor(() => expect(snapshots.at(-1)?.canSend).toBe(true));
    const generation = snapshots.at(-1).generation;
    await bindings.get('fischLiveConversation')({ page, frame }, { action: 'send', generation, text: 'User text' });
    await vi.waitFor(() => expect(snapshots.at(-1)?.messages.some(value => value.text === 'Canonical fixture reply' && value.status === 'completed')).toBe(true));
    expect(snapshots.at(-1).canSend).toBe(true);
    await vi.waitFor(() => expect(controls.filter(value => value.type === 'tool')).toHaveLength(8));
    expect(() => bindings.get('fischPanelRespond')({ page, frame: {} }, {})).toThrow('panel_control_source_rejected');
  } finally { abort.abort(); expect(await run).toBe(130); }
});

it('does not initialize any client when the host is already cancelled', async () => {
  const abort = new AbortController(); abort.abort(); const clientFactory = vi.fn();
  expect(await runPanelCodex({ signal: abort.signal, clientFactory })).toBe(130);
  expect(clientFactory).not.toHaveBeenCalled();
});

it('fences cancellation while a real app-server fixture holds thread initialization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fisch-panel-init-')), marker = join(directory, 'requested');
  const script = `const fs=require('node:fs');let b='';process.stdin.on('data',c=>{b+=c;let n;while((n=b.indexOf('\\n'))>=0){let m=JSON.parse(b.slice(0,n));b=b.slice(n+1);if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');if(m.method==='thread/start')fs.writeFileSync(${JSON.stringify(marker)},m.method);}});`;
  const { page } = panelPage(), abort = new AbortController();
  const run = runPanelCodex({ live: { page, base: 'http://127.0.0.1:1', token: 'fixture' }, cwd: process.cwd(), signal: abort.signal, reactiveProvider: null, host: { command: process.execPath, args: ['-e', script, '--'] } });
  try { await vi.waitFor(async () => expect(await readFile(marker, 'utf8')).toBe('thread/start'), { timeout: 5000 }); }
  finally { abort.abort(); expect(await run).toBe(130); await rm(directory, { recursive: true, force: true }); }
});
it('routes panel options explicitly without changing terminal or Desktop ownership', () => {
  expect(parseLiveOptions(['--panel', '--thread', 'saved-thread'])).toEqual({ panel: true, resumeThreadId: 'saved-thread' });
  for (const args of [['--thread', 'saved'], ['--panel', '--agent', 'pane'], ['--thread', '--panel'], ['--panel', '--panel']]) expect(() => parseLiveOptions(args)).toThrow();
});
