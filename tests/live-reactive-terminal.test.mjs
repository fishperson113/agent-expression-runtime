import { expect, it, vi } from 'vitest';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { runTerminalCodex } from '../integrations/live-terminal.mjs';
import { createLiveReactiveProvider } from '../integrations/live-reactive-provider.mjs';

const fakeServer = `let b='',seen=[],turnNo=0,active;const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');process.stdin.on('data',c=>{b+=c;let n;while((n=b.indexOf('\\n'))>=0){const m=JSON.parse(b.slice(0,n));b=b.slice(n+1);if(m.method==='test/snapshot'){send({id:m.id,result:{seen,keys:Object.keys(process.env).filter(k=>k.startsWith('FISCH_REACTIVE_'))}});continue}seen.push(m);let result={};if(m.method==='thread/start')result={thread:{id:'native'}};if(m.method==='turn/start'){active=++turnNo===1?'user':'user_'+turnNo;result={turn:{id:active,status:'inProgress'}}};send({id:m.id,result});if(m.method==='turn/start')send({method:'item/agentMessage/delta',params:{threadId:'native',turnId:active,itemId:'reply_'+active,delta:'A synthetic conversational reply.'}});if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'native',turn:{id:m.params.turnId??active,status:'interrupted'}}})}});`;
const validWindow = revision => ({ schemaVersion: 1, request: { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'camera',
  intentRevision: revision, presenceRevision: 1, deadline: 100000, requiredTrackIds: [] }, events: [{ id: 1, type: 'user_arrived', at: 100 }],
  observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100, camera: 'tracking', turn: 'idle', summary: 'LOCAL_ONLY_SUMMARY',
    user: { present: false, quality: { score: 0, basis: 'unavailable' }, position: null, head: null, facingScreen: null,
      expression: null, mouthMoving: null } }] });
async function start(reactiveProvider) {
  let socket, nativeEnv, child; let id = 0; const pending = new Map(), selected = [], deliveries = [], candidates = [], actions = [], notifications = [];
  const controller = new AbortController();
  const api = { intent: 0, available: false, busy: false, barrier: async () => {}, current: null,
    polls: 0, activity() { this.polls++; }, logActivity() {}, configureReactive(value) { this.available = value; }, setReactiveUserBusy(value) { this.busy = value; },
    selectThread() { selected.push('native'); }, async reactiveUserIntent() { await this.barrier(); this.intent++; },
    takeReactiveRequest() { this.current = candidates.shift() ?? null; return this.current; },
    authorizeReactiveRequest(id) { return this.current?.request.requestId === id && !this.busy; },
    deliverReactiveDecision(id, data) { const reason = !data ? 'invalid_decision' : this.current.request.intentRevision !== this.intent ? 'stale' : 'accepted';
      deliveries.push({ id, data, reason }); if (reason === 'accepted') actions.push(data); return { reason }; }, failReactiveDecision() {} };
  const frame = { url: () => 'http://127.0.0.1:1/live.html' };
  const page = Object.assign(new EventEmitter(), { url: frame.url, mainFrame: () => frame, exposeBinding: async () => {},
    isClosed: () => false, evaluate: async (fn, arg) => {
    const previous = globalThis.window; globalThis.window = { fischLive: api };
    try { return await fn(arg); } finally { globalThis.window = previous; }
  } });
  const running = runTerminalCodex({ live: { page, base: 'http://127.0.0.1:1', token: 'test-gateway-token' }, cwd: process.cwd(), signal: controller.signal,
    host: { command: process.execPath, args: ['-e', fakeServer, '--'] }, reactiveProvider,
    spawnClient: (_command, args, options) => {
      nativeEnv = options.env; child = new EventEmitter();
      socket = new WebSocket(args[args.indexOf('--remote') + 1], { headers: { Authorization: 'Bearer ' + options.env.FISCH_CODEX_TRANSPORT_TOKEN } });
      socket.on('error', () => {}); socket.on('message', bytes => { const value = JSON.parse(bytes.toString()); if (value.method) notifications.push(value);
        if (pending.has(value.id)) { pending.get(value.id)(value); pending.delete(value.id); } }); return child;
    } });
  await vi.waitFor(() => expect(socket).toBeDefined()); if (socket.readyState !== WebSocket.OPEN) await once(socket, 'open');
  const call = (method, params = {}) => new Promise(resolve => { const requestId = ++id; pending.set(requestId, resolve); socket.send(JSON.stringify({ id: requestId, method, params })); });
  await call('initialize'); await call('thread/start');
  return { call, api, deliveries, selected, actions, notifications, nativeEnv, camera: () => { const observationWindow = validWindow(api.intent);
    candidates.push({ request: observationWindow.request, observationWindow }); }, close: async () => {
    controller.abort(); child.emit('exit', 0); await running; socket.terminate();
  } };
}
it('keeps the default observer off and removes new credentials from both native child environments', async () => {
  vi.stubEnv('FISCH_REACTIVE_BACKEND', 'off'); vi.stubEnv('FISCH_REACTIVE_API_KEY', 'PRIVATE_NEW_KEY');
  const f = await start(undefined);
  try {
    f.camera(); await vi.waitFor(() => expect(f.api.polls).toBeGreaterThanOrEqual(2));
    const { result } = await f.call('test/snapshot'); expect(result.keys).toEqual([]);
    expect(Object.keys(f.nativeEnv).filter(key => key.startsWith('FISCH_REACTIVE_'))).toEqual([]);
    expect(result.seen.some(message => message.method === 'turn/start')).toBe(false);
    expect(f.api.available).toBe(false); expect(f.deliveries).toEqual([]);
  } finally { await f.close(); vi.unstubAllEnvs(); }
});
it('routes camera data through real provider factory/parser without native history, prose or tool execution', async () => {
  vi.stubEnv('FISCH_REACTIVE_API_KEY', 'PRIVATE_NEW_KEY'); const directory = mkdtempSync(join(tmpdir(), 'fisch-terminal-'));
  try {
    for (const output of [[{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PRIVATE_PROVIDER_PROSE' }] }],
      [{ type: 'function_call', name: 'shell', arguments: 'PRIVATE_TOOL_TEXT' }]]) {
      const path = join(directory, 'budget.json'); writeFileSync(path, JSON.stringify({ used: 0, limit: 120, deadline: new Date(Date.now() + 60000).toISOString(), turns: [] }));
      const requests = [], configured = createLiveReactiveProvider({ FISCH_REACTIVE_BACKEND: 'responses', FISCH_REACTIVE_MODEL: 'fake',
        FISCH_REACTIVE_URL: 'http://127.0.0.1:1/v1/responses', FISCH_REACTIVE_BUDGET: path }, { fetch: async (_url, options) => {
        requests.push(JSON.parse(options.body)); return new Response(JSON.stringify({ status: 'completed', output }));
      } });
      const f = await start(configured.provider);
      try {
        await f.call('turn/start', { threadId: 'native', input: [{ type: 'text', text: 'PRIVATE_NATIVE_HISTORY' }] });
        await f.call('turn/interrupt', { threadId: 'native', turnId: 'user' }); f.camera();
        await vi.waitFor(() => expect(f.deliveries).toHaveLength(1));
        const snapshot = (await f.call('test/snapshot')).result;
        expect(JSON.stringify(snapshot.seen)).toContain('PRIVATE_NATIVE_HISTORY');
        expect(snapshot.seen.filter(message => message.method === 'turn/start')).toHaveLength(1);
        expect(JSON.stringify(snapshot.seen)).not.toMatch(/PRIVATE_PROVIDER_PROSE|PRIVATE_TOOL_TEXT|fisch_local_observation/);
        expect(requests).toHaveLength(1); expect(JSON.stringify(requests)).not.toMatch(/PRIVATE_NATIVE_HISTORY|LOCAL_ONLY_SUMMARY|PRIVATE_NEW_KEY/);
        expect(requests[0].tools).toEqual([]); expect(requests[0].tool_choice).toBe('none');
        expect(readFileSync(path, 'utf8')).toContain('"used": 1'); expect(f.actions).toEqual([]); expect(f.deliveries[0].data).toBe(null);
      } finally { await f.close(); }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
});
it('revokes browser authority before native input while provider stays pending and only steers the actual user turn', async () => {
  let complete, providerSignal; const requests = [];
  const f = await start({ decide: (value, signal) => { requests.push(value); providerSignal = signal; return new Promise(resolve => { complete = resolve; }); } });
  try {
    f.camera(); await vi.waitFor(() => expect(requests).toHaveLength(1)); let release, entered = false;
    f.api.barrier = () => { entered = true; return new Promise(resolve => { release = resolve; }); };
    const user = f.call('turn/start', { threadId: 'native', input: [{ type: 'text', text: 'PRIVATE_USER_INPUT' }] });
    await vi.waitFor(() => expect(entered).toBe(true));
    expect((await f.call('test/snapshot')).result.seen.filter(message => message.method === 'turn/start')).toEqual([]);
    expect(providerSignal.aborted).toBe(true); release(); await user; f.api.barrier = async () => {};
    expect((await f.call('turn/steer', { threadId: 'native', expectedTurnId: 'wrong' })).error).toBeDefined();
    expect((await f.call('turn/steer', { threadId: 'native', expectedTurnId: 'user', input: [] })).error).toBeUndefined();
    complete({ schemaVersion: 1, requestId: 'camera', decisionId: 'd', mode: 'observe', action: null, validUntil: 900 });
    await vi.waitFor(() => expect(f.deliveries).toHaveLength(1)); expect(f.deliveries[0].reason).toBe('stale');
    const snapshot = (await f.call('test/snapshot')).result;
    expect(snapshot.seen.filter(message => message.method === 'turn/start')).toHaveLength(1);
    expect(snapshot.seen.filter(message => message.method === 'turn/interrupt')).toEqual([]);
    expect(snapshot.seen.filter(message => message.method === 'turn/steer')).toHaveLength(1);
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_USER_INPUT'); expect(f.actions).toEqual([]);
  } finally { await f.close(); }
});

it.each(['absent', 'observe'])('keeps conversation and its input barrier usable when the observer is %s', async mode => {
  const provider = mode === 'absent' ? null : { decide: vi.fn(async window => ({ schemaVersion: 1,
    requestId: window.request.requestId, decisionId: 'quiet', mode: 'observe', action: null, validUntil: window.request.deadline })) };
  const f = await start(provider);
  try {
    if (provider) {
      f.camera(); await vi.waitFor(() => expect(f.deliveries).toHaveLength(1));
      expect(f.deliveries[0].data).toMatchObject({ mode: 'observe', action: null });
    }
    let release, entered = false;
    f.api.barrier = () => { entered = true; return new Promise(resolve => { release = resolve; }); };
    const firstInput = [{ type: 'text', text: 'What shall we make together?' }];
    const firstTurn = f.call('turn/start', { threadId: 'native', input: firstInput });
    await vi.waitFor(() => expect(entered).toBe(true));
    expect((await f.call('test/snapshot')).result.seen.filter(m => m.method === 'turn/start')).toEqual([]);
    release(); expect((await firstTurn).error).toBeUndefined(); f.api.barrier = async () => {};
    await vi.waitFor(() => expect(f.notifications.some(m => m.method === 'item/agentMessage/delta')).toBe(true));
    await f.call('turn/interrupt', { threadId: 'native', turnId: 'user' });
    const secondInput = [{ type: 'text', text: 'Let us keep talking quietly.' }];
    const secondTurn = await f.call('turn/start', { threadId: 'native', input: secondInput });
    expect(secondTurn.error).toBeUndefined(); expect(secondTurn.result.turn.id).toBe('user_2');
    await vi.waitFor(() => expect(f.notifications.filter(m => m.method === 'item/agentMessage/delta').map(m => m.params.turnId)).toEqual(['user', 'user_2']));
    const seen = (await f.call('test/snapshot')).result.seen;
    expect(seen.filter(m => m.method === 'turn/start').map(m => m.params.input)).toEqual([firstInput, secondInput]);
    expect(seen.filter(m => m.method === 'turn/interrupt')).toHaveLength(1);
    expect(seen.find(m => m.method === 'thread/start').params.developerInstructions).toContain('`express`');
    expect(f.nativeEnv.FISCH_LIVE).toBe('1');
    expect(seen.some(m => m.method === 'item/toolOutput' || JSON.stringify(m).includes('fisch_local_observation'))).toBe(false);
    expect(f.deliveries.every(d => d.data?.action === null)).toBe(true);
    if (provider) expect(provider.decide).toHaveBeenCalledTimes(1);
    else expect(f.api.available).toBe(false);
  } finally { await f.close(); }
});
