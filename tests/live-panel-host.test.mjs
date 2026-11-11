import { it, expect, vi } from 'vitest';
import { runPanelCodex } from '../integrations/live-panel.mjs';

it('boots a selected panel thread and submits browser text through the same canonical transport without a terminal', async () => {
  const script = `let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const m=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'panel-thread'}}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'panel-turn',status:'inProgress'}}});send({method:'turn/started',params:{threadId:'panel-thread',turn:{id:'panel-turn'}}});for(let i=0;i<8;i++)send({method:'item/started',params:{threadId:'panel-thread',turnId:'panel-turn',item:{id:'tool-'+i,type:'mcpToolCall',server:'fisch_live',tool:'observe',status:'inProgress'}}});send({method:'item/agentMessage/delta',params:{threadId:'panel-thread',turnId:'panel-turn',itemId:'answer',delta:'Canonical fixture reply'}});send({method:'turn/completed',params:{threadId:'panel-thread',turn:{id:'panel-turn',status:'completed'}}});}}});`;
  const bindings = new Map(), controls = [], snapshots = [], abort = new AbortController();
  const frame = { url: () => 'http://127.0.0.1:1234/live.html' };
  const api = { selectThread: () => {}, setupStatus: () => {}, panelControlStatus: value => controls.push(value),
    conversationStatus: value => snapshots.push(value), activity: () => {}, configureReactive: () => {}, setReactiveUserBusy: () => {},
    reactiveUserIntent: () => {}, takeReactiveRequest: () => null };
  const page = { url: frame.url, mainFrame: () => frame, isClosed: () => false, on: () => {}, off: () => {},
    exposeBinding: async (name, callback) => bindings.set(name, callback),
    evaluate: async (fn, arg) => { if (String(fn).includes('panelControlStatus')) await new Promise(resolve => setTimeout(resolve, 2)); const old = globalThis.window; globalThis.window = { fischLive: api };
      try { return await fn(arg); } finally { globalThis.window = old; } } };
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
