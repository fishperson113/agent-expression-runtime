import { LiveStreamingPresentationBridge } from '../integrations/presentation-streaming-bridge.mjs';
import { NativePresentationProvider } from '../integrations/presentation-provider.mjs';
import { compositionTool } from '../integrations/compose-expression.mjs';
import { liveToolDefinitions } from '../integrations/live-tools.mjs';
import { expressionStatusTool } from '../integrations/expression-status.mjs';
import { nativeLiveInstructions, nativeToolManifest } from '../integrations/live-instruction-bundle.mjs';
import { capabilityResource } from '../integrations/capability-contract.mjs';
import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch, parseLiveOptions } from '../bin/fisch.mjs';
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
  return { bindings, controls, snapshots, page, frame, api };
}
it('boots a selected panel thread and submits browser text through the same canonical transport without a terminal', async () => {
  const script = `let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const m=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'panel-thread'}}});if(m.method==='mcpServer/tool/call')send({id:m.id,error:{code:-32601,message:'fixture unsupported'}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'panel-turn',status:'inProgress'}}});send({method:'turn/started',params:{threadId:'panel-thread',turn:{id:'panel-turn'}}});for(let i=0;i<8;i++)send({method:'item/started',params:{threadId:'panel-thread',turnId:'panel-turn',item:{id:'tool-'+i,type:'mcpToolCall',server:'fisch_live',tool:'observe',status:'inProgress'}}});send({method:'item/agentMessage/delta',params:{threadId:'panel-thread',turnId:'panel-turn',itemId:'answer',delta:'Canonical fixture reply'}});send({method:'turn/completed',params:{threadId:'panel-thread',turn:{id:'panel-turn',status:'completed'}}});}}});`;
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

it('starts the primary thread without Fisch instructions or tools and fences cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fisch-panel-init-')), marker = join(directory, 'requested');
  const script = `const fs=require('node:fs');let b='';process.stdin.on('data',c=>{b+=c;let n;while((n=b.indexOf('\\n'))>=0){let m=JSON.parse(b.slice(0,n));b=b.slice(n+1);if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');if(m.method==='thread/start')fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify(m.params));}});`;
  const { page } = panelPage(), abort = new AbortController();
  const run = runPanelCodex({ live: { page, base: 'http://127.0.0.1:1', token: 'fixture' }, cwd: process.cwd(), signal: abort.signal, reactiveProvider: null, host: { command: process.execPath, args: ['-e', script, '--'] } });
  try {
    let request;
    await vi.waitFor(async () => { request = JSON.parse(await readFile(marker, 'utf8')); });
    {
      expect(request.developerInstructions).toBeUndefined();
      expect(request.baseInstructions).toBeUndefined();
      expect(request.dynamicTools).toBeUndefined();
      expect(request.config).toBeUndefined();
      expect(request.model).toBeUndefined();
      expect(request.effort).toBeUndefined();
      expect(JSON.stringify(request)).not.toMatch(/FISCH_LIVE_BODY|compose_expression|aer:\/\//);
    }
  }
  finally { abort.abort(); expect(await run).toBe(130); await rm(directory, { recursive: true, force: true }); }
});
it('routes default panel and explicit terminal options without changing Desktop ownership', async () => {
  expect(parseLiveOptions(['--panel', '--thread', 'saved-thread'])).toEqual({ panel: true, resumeThreadId: 'saved-thread' });
  const desktop=vi.fn();await dispatch(['desktop'],{desktop});expect(desktop).toHaveBeenCalledWith({});
  for(const mode of ['--panel','--terminal'])await expect(dispatch(['desktop',mode],{desktop})).rejects.toThrow('Desktop MCP');
  expect(parseLiveOptions([])).toEqual({});
  expect(parseLiveOptions(['--thread', 'saved'])).toEqual({ resumeThreadId: 'saved' });
  expect(parseLiveOptions(['--terminal'])).toEqual({ panel: false });
  for (const args of [['--terminal', '--terminal'], ['--terminal', '--agent', 'pane'], ['--terminal', '--thread', 'saved'], ['--thread', 'saved', '--agent', 'pane'], ['--terminal', '--panel'], ['--panel', '--terminal'], ['--panel', '--agent', 'pane'], ['--thread', '--panel'], ['--panel', '--panel']]) expect(() => parseLiveOptions(args)).toThrow();
});

it('preloads exact static resources without claiming live state or changing standalone MCP discovery', async () => {
  const instructions = nativeLiveInstructions();
  const authored = await readFile(new URL('../integrations/live-instructions.md', import.meta.url), 'utf8');
  expect(instructions.startsWith(authored)).toBe(true);
  for (const uri of ['aer://capabilities/v1', 'aer://workflow/v1']) {
    expect(instructions).toContain(`${uri}\n${capabilityResource(uri).contents[0].text}`);
  }
  expect(instructions).toContain('NOT current scene, ownership, camera state or execution evidence');
  expect(instructions).toContain('without an observe prerequisite');
  expect(instructions.length - authored.length - nativeToolManifest().length).toBeLessThan(14000);
});

it('supplies exact installed schemas once without granting scene authority', () => {
  const manifest = nativeToolManifest();
  const data = JSON.parse(manifest.slice(manifest.indexOf('[{')));
  expect(data).toEqual([compositionTool, liveToolDefinitions().find(t => t.name === 'inspect_expression'), expressionStatusTool]
    .map(t => ({ ...t, callable: 'tools.mcp__fisch_live__' + t.name })));
  expect(nativeLiveInstructions().split('## Installed Fisch tool manifest')).toHaveLength(2);
  expect(manifest).toContain('not current state or authority');
  expect(manifest).toContain('If actual contract mismatches');
});


function streamedHostScript(first, last) {
  return `let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){
    const m=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
    if(m.method==='initialize')send({id:m.id,result:{}});
    if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'stream-thread'}}});
    if(m.method==='turn/start'){
      send({id:m.id,result:{turn:{id:'stream-turn',status:'inProgress'}}});
      const params={threadId:'stream-thread',turnId:'stream-turn'};
      send({method:'turn/started',params:{...params,turn:{id:'stream-turn'}}});
      send({method:'item/started',params:{...params,item:{id:'user',type:'userMessage',content:m.params.input}}});
      send({method:'item/started',params:{...params,item:{id:'answer',type:'agentMessage',phase:'final_answer',text:''}}});
      send({method:'item/agentMessage/delta',params:{...params,itemId:'answer',delta:${JSON.stringify(first)}}});
      setTimeout(()=>{
        send({method:'item/agentMessage/delta',params:{...params,itemId:'answer',delta:${JSON.stringify(last)}}});
        send({method:'item/completed',params:{...params,item:{id:'answer',type:'agentMessage',phase:'final_answer',text:${JSON.stringify(first+last)}}}});
        send({method:'turn/completed',params:{...params,turn:{id:'stream-turn',status:'completed'}}});
      },500);
    }
  }});`;
}

it.each(['pending', 'reject', 'throw'])('publishes unchanged partial and complete native text while streaming observer %s', async mode => {
  const visual = vi.spyOn(LiveStreamingPresentationBridge.prototype, 'observe').mockImplementation(() => {
    if (mode === 'throw') throw Error('visual_only');
    return mode === 'reject' ? Promise.reject(Error('visual_only')) : new Promise(() => {});
  });
  try { await assertUnblockedStream(); } finally { visual.mockRestore(); }
});

async function assertUnblockedStream(provider) {
  const first = 'A queue preserves arrival order and lets a consumer process messages independently. Producers can continue sending while the consumer works, until the bounded queue reaches capacity.';
  const last = ' Backpressure then limits new messages without changing earlier ones.';
  const { bindings, controls, snapshots, page, frame, api } = panelPage(), abort = new AbortController();
  api.presentationSnapshot = () => ({ scope: { fixture: true }, partIds: [] });
  api.revokePresentation = () => {};
  const run = runPanelCodex({ live: { page, base: 'http://127.0.0.1:1', token: 'fixture' }, cwd: process.cwd(),
    signal: abort.signal, reactiveProvider: null, host: { command: process.execPath, args: ['-e', streamedHostScript(first, last), '--'] } });
  try {
    await vi.waitFor(() => expect(controls.some(value => value.type === 'ready')).toBe(true));
    await vi.waitFor(() => expect(snapshots.at(-1)?.canSend).toBe(true));
    await bindings.get('fischLiveConversation')({ page, frame }, { action: 'send', generation: snapshots.at(-1).generation, text: 'queue là gì á' });
    await vi.waitFor(() => expect(snapshots.some(s => s.messages.some(m => m.text === first && m.status === 'streaming'))).toBe(true));
    if (provider) {
      await vi.waitFor(() => expect(provider).toHaveBeenCalled());
      expect(provider.mock.calls[0][0].assistantText).toBe(first);
    }
    await vi.waitFor(() => expect(snapshots.at(-1)?.messages.some(m => m.text === first + last && m.status === 'completed')).toBe(true));
    expect(snapshots.at(-1).messages.filter(m => m.role === 'user').map(m => m.text)).toEqual(['queue là gì á']);
    expect(snapshots.at(-1).error).toBe('');
  } finally { abort.abort(); expect(await run).toBe(130); }
}

it.each(['pending', 'reject'])('keeps streaming with actual observer after visual provider entered: %s', async mode => {
  const provider = vi.spyOn(NativePresentationProvider.prototype, 'generate').mockImplementation((_input, signal) => {
    if (mode === 'reject') return Promise.reject(Error('visual_provider_failed'));
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(Error('cancelled'));
      signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true });
    });
  });
  try { await assertUnblockedStream(provider); } finally { provider.mockRestore(); }
});
