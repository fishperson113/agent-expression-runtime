import { startDesktopObserver } from '../integrations/desktop-observer.mjs';
import { startDesktopIntentServer } from '../integrations/desktop-intent.mjs';
import { composeExpression } from '../integrations/compose-expression.mjs';
import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { reactionObservationData } from '../integrations/native-reaction-provider.mjs';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createLiveReactiveProvider } from '../integrations/live-reactive-provider.mjs';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';
import { runTerminalCodex } from '../integrations/live-terminal.mjs';
import { runLiveSession } from '../scripts/live-session.mjs';
import { openLive } from '../integrations/live-launch.mjs';
import { gatewayExecutable } from '../scripts/start-session.mjs';
const fixture = fileURLToPath(new URL('./fixtures/conversation-host-agent.mjs', import.meta.url));
async function browserRoute({ expression = false } = {}) {
  const abort = new AbortController(); let live, child, next, tag = 0;
  const running = runLiveSession({ headless: true, assets: false, signal: abort.signal,
    open: options => openLive({ ...options, production: false, synthetic: true }),
    runHost: options => { live = options.live; return runTerminalCodex({ ...options, reactiveProvider: null,
      host: { command: process.execPath, args: [expression ? fileURLToPath(new URL('./fixtures/playground-agent.mjs', import.meta.url)) : fixture] }, spawnClient: (command, args, settings) => {
        child = spawn(command, args, { ...settings, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stderr.resume(); next = inbox(child); return child;
      } }); } });
  void running.catch(() => {});
  const close = async () => { abort.abort(); child?.stdin.end(); await running.catch(() => {}); };
  try {
    await vi.waitFor(() => expect(next).toBeTypeOf('function'), { timeout: 60000 });
    const ready = await next(value => value.type === 'ready');
    const call = async (method, params = {}) => { const own = ++tag;
      child.stdin.write(JSON.stringify({ method, params, tag: own }) + '\n');
      return (await next(value => value.type === 'reply' && value.tag === own)).value;
    };
    return { live, call, close, next, ready, running };
  } catch (error) { await close(); throw error; }
}
function inbox(child) {
  const values = [], waiters = []; let buffer = '';
  child.stdout.on('data', bytes => { buffer += bytes; let end;
    if (buffer.length > 1048576) throw Error('synthetic_output_limit');
    while ((end = buffer.indexOf('\n')) >= 0) { const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      values.push(value); if (values.length > 64) values.shift(); for (const resolve of waiters.splice(0)) resolve(); } });
  return async predicate => { for (let i = 0; i < 100; i++) { const found = values.find(predicate); if (found) return found;
    await new Promise(resolve => { const timer = setTimeout(resolve, 50); waiters.push(() => { clearTimeout(timer); resolve(); }); }); } throw Error('synthetic_timeout'); };
}
async function start({ silent = false } = {}) {
  const page = new EventEmitter(), abort = new AbortController(), bindings = new Map(), snapshots = [];
  let child, next, tag = 0; const previous = globalThis.window;
  const api = { intent: 0, clears: 0, draft: '', last: undefined, available: false, busy: false,
    activity() {}, logActivity() {}, setupStatus() {}, configureReactive(value) { this.available = value; }, setReactiveUserBusy(value) { this.busy = value; },
    selectThread() { this.intent++; }, playgroundClear() {}, conversationClear() { this.clears++; this.draft = ''; this.last = undefined; },
    conversationStatus(value) { this.last = structuredClone(value); snapshots.push(this.last); if (snapshots.length > 32) snapshots.shift(); },
    async reactiveUserIntent() { this.intent++; }, takeReactiveRequest() { return null; } };
  const frame = { url: () => 'http://127.0.0.1:1/live.html' };
  page.url = frame.url; page.mainFrame = () => frame; page.isClosed = () => false;
  page.exposeBinding = async (name, callback) => bindings.set(name, callback);
  page.evaluate = async (fn, value) => fn(value); globalThis.window = { fischLive: api };
  const running = runTerminalCodex({ live: { page, base: 'http://127.0.0.1:1', token: 'synthetic' }, cwd: process.cwd(), signal: abort.signal,
    reactiveProvider: null, host: { command: process.execPath, args: [fixture, ...(silent ? ['--silent'] : [])] },
    spawnClient: (command, args, options) => { child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] }); child.stderr.resume(); next = inbox(child); return child; } });
  void running.catch(() => {});
  const close = async () => { abort.abort(); child?.stdin.end(); await running.catch(() => {}); globalThis.window = previous; };
  try { await vi.waitFor(() => expect(next).toBeTypeOf('function')); await next(value => value.type === 'ready');
    const call = async (method, params = {}) => { const own = ++tag; child.stdin.write(JSON.stringify({ method, params, tag: own }) + '\n');
      return (await next(value => value.type === 'reply' && value.tag === own)).value; };
    const invoke = value => bindings.get('fischLiveConversation')({ page, frame }, value);
    return { page, frame, api, snapshots, call, invoke, close, bindings, next };
  } catch (error) { await close(); throw error; }
}
it('awaits the selected-thread revocation before releasing the Native reply', async () => {
  const f = await start(); let release;
  try {
    f.api.selectThread = () => new Promise(resolve => { release = resolve; });
    let replied = false; const selection = f.call('thread/start').then(() => { replied = true; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await new Promise(resolve => setTimeout(resolve, 30)); expect(replied).toBe(false);
    release(); await selection; expect(replied).toBe(true);
  } finally { release?.(); await f.close(); }
});
it('keeps the isolated observer available cold, but fences unknown intent across held authorization', async () => {
  const previous = globalThis.window;
  for (const unknown of [false, true]) {
    const request = { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'r', intentRevision: 0, presenceRevision: 1, deadline: 1000, requiredTrackIds: [] };
    const candidate = { request, observationWindow: { schemaVersion: 1, request: { ...request }, events: [{ id: 1, type: 'user_arrived', at: 100 }],
      observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100, camera: 'absent', turn: 'idle', summary: 'local',
        user: { present: false, quality: { score: 0, basis: 'unavailable' }, position: null, head: null, expression: null, facingScreen: null, mouthMoving: null } }] } };
    let release, calls = 0, taken = false, error = ''; const deliveries = [];
    const api = { conversationDocument: 'doc', conversationStatus() {}, activity() {}, configureReactive() {}, setReactiveUserBusy() {}, reactiveUserIntent() {},
      takeReactiveRequest() { if (taken) return null; taken = true; return candidate; }, authorizeReactiveRequest: () => new Promise(resolve => { release = resolve; }),
      deliverReactiveDecision(id, data) { deliveries.push(data); return { reason: 'revoked' }; }, failReactiveDecision() {} };
    globalThis.window = { fischLive: api };
    const broker = new LiveReactiveBroker({ page: { evaluate: async (fn, value) => fn(value) }, provider: { decide: async () => { calls++; return { mode: 'observe' }; } },
      output: { thread: 't' }, forward() {}, reject() {} });
    try {
      await broker.poll({}, [], () => ({ token: 'doc', snapshot: { available: false, pending: false, stopping: false, error } }));
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      if (unknown) { broker.client({ id: 'user', method: 'turn/start', params: { threadId: 't' } });
        await new Promise(resolve => setTimeout(resolve, 0)); broker.pending.delete('user'); error = 'conversation_unknown'; }
      release(true); await vi.waitFor(() => expect(deliveries).toHaveLength(1)); expect(calls).toBe(unknown ? 0 : 1);
    } finally { broker.close(); globalThis.window = previous; }
  }
});
it('binds actual host sends, canonical ACK-only cancellation, notifications and confirmed thread changes', async () => {
  const f = await start();
  try {
    expect(f.bindings.has('fischLiveConversation')).toBe(true);
    await vi.waitFor(() => expect(f.api.last?.canSend).toBe(true));
    const generation = f.api.last.generation;
    expect(await f.invoke({ action: 'send', generation, text: 'Public synthetic request.' })).toEqual({ status: 'accepted' });
    await vi.waitFor(() => expect(f.api.last?.messages).toHaveLength(2)); expect(f.api.last.canCancel).toBe(true);
    expect(f.api.last.messages.map(value => value.text)).toEqual(['Public synthetic request.', 'Public synthetic reply.']);
    await f.call('test/approval'); await vi.waitFor(() => expect(f.api.last.waiting).toBe(true));
    expect(await f.invoke({ action: 'cancel', generation })).toEqual({ status: 'stopping' });
    await vi.waitFor(() => expect(f.api.last.canCancel).toBe(false)); expect(f.api.last.messages.every(value => value.status === 'interrupted')).toBe(true);
    f.api.draft = 'Public unsent draft'; const clears = f.api.clears;
    await f.call('thread/resume', { threadId: 'missing' }); await f.call('thread/resume', { threadId: 'thread-1' });
    expect(f.api.draft).toBe('Public unsent draft'); expect(f.api.clears).toBe(clears);
    await f.call('thread/start'); await vi.waitFor(() => expect(f.api.last?.generation).toBeGreaterThan(generation));
    expect(f.api.draft).toBe(''); expect(f.api.last.messages).toEqual([]);
    const state = (await f.call('test/snapshot')).result;
    expect(state.seen.filter(value => value.method === 'turn/start')).toHaveLength(1); expect(state.keys).toEqual([]);
  } finally { await f.close(); }
});
it('projects a Native normal-text submission once without resending canonical or realtime text', async () => {
  const f = await start(); let release, revoked = false;
  try {
    await vi.waitFor(() => expect(f.api.last?.canSend).toBe(true));
    const threadId = 'thread-1', text = 'Synthetic recognised text; no microphone or transcription was used.';
    f.api.reactiveUserIntent = async () => { await new Promise(resolve => { release = resolve; }); revoked = true; };
    const submitted = f.call('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect((await f.call('test/snapshot')).result.seen.filter(row => row.method === 'turn/start')).toEqual([]);
    release(); await submitted; expect(revoked).toBe(true);
    await f.call('test/canonical-duplicates');
    await vi.waitFor(() => expect(f.api.last.messages).toHaveLength(2));
    expect(f.api.last.messages.map(row => [row.role, row.text])).toEqual([['user', text], ['assistant', 'Public synthetic reply.']]);
    const starts = (await f.call('test/snapshot')).result.seen.filter(row => row.method === 'turn/start');
    expect(starts).toEqual([{ method: 'turn/start', thread: threadId, text }]);
    expect(JSON.stringify(f.api.last)).not.toContain('UNSUBMITTED_REALTIME_CANARY');
    if (process.env.FISCH_NATIVE_TEXT_RELAY_EVIDENCE) writeFileSync(process.env.FISCH_NATIVE_TEXT_RELAY_EVIDENCE,
      JSON.stringify({ mode: 'scripted_native_protocol_actual_websocket_relay', actualModelCalls: 0, realMedia: false, nativeDictationVerified: false,
        heldUntilRevocation: true, revokedBeforeAcknowledgement: revoked, forwardedStarts: starts, messages: f.api.last.messages, transcriptResubmissions: starts.length - 1 }, null, 2), { mode: 0o600 });
  } finally { release?.(); await f.close(); }
});
it('publishes a late canonical Cancel without a revision change while unknown send stays sticky', async () => {
  const f = await start({ silent: true });
  try {
    await vi.waitFor(() => expect(f.api.last?.canSend).toBe(true)); const generation = f.api.last.generation;
    const outcome = f.invoke({ action: 'send', generation, text: 'Public synthetic unknown request.' }).catch(error => error.message);
    await f.next(value => value.type === 'event' && value.value.method === 'test/sent');
    expect(await outcome).toBe('conversation_unknown'); await vi.waitFor(() => expect(f.api.last.error).toBe('conversation_unknown'));
    const revision = f.api.last.revision; await f.call('test/late');
    await vi.waitFor(() => expect(f.api.last.canCancel).toBe(true)); expect(f.api.last.revision).toBe(revision);
    expect(f.api.last.canSend).toBe(false); expect(f.api.busy).toBe(true);
    await expect(f.invoke({ action: 'send', generation, text: 'Do not resend' })).rejects.toThrow('conversation_unavailable');
    expect((await f.call('test/snapshot')).result.seen.filter(value => value.method === 'turn/start')).toHaveLength(1);
  } finally { await f.close(); }
}, 20000);
it('revokes the binding on reload and publishes an actionable empty restart state', async () => {
  const f = await start();
  try {
    await vi.waitFor(() => expect(f.api.last?.canSend).toBe(true)); const generation = f.api.last.generation;
    f.page.emit('request', { isNavigationRequest: () => true, frame: () => f.frame });
    delete f.api.conversationDocument; f.api.last = undefined;
    await vi.waitFor(() => expect(f.api.last?.error).toBe('conversation_restart_required'));
    expect(f.api.last.messages).toEqual([]); expect(f.api.last.available).toBe(false);
    await f.call('thread/start'); await vi.waitFor(() => expect(f.api.last?.error).toBe('conversation_restart_required'));
    expect(f.api.last.canSend).toBe(false);
    await expect(f.invoke({ action: 'send', generation, text: 'Public stale callback' })).rejects.toThrow('conversation_unavailable');
  } finally { await f.close(); }
});

const requireBrowserGateway = process.env.FISCH_PLAYGROUND_REQUIRE_GATEWAY === '1';
it.skipIf(!existsSync(gatewayExecutable()) && !requireBrowserGateway)('sends and interrupts through the actual Live DOM, relay and Native fixture, then fences selection and reload', async () => {
  let route = await browserRoute(); const page = route.live.page;
  try {
    const chat = page.locator('.fisch-conversation'), input = chat.locator('textarea');
    const send = chat.getByRole('button', { name: 'Gửi', exact: true });
    const cancel = chat.getByRole('button', { name: 'Dừng trả lời', exact: true });
    await expect.poll(() => input.isEnabled(), { timeout: 5000 }).toBe(true);
    await input.fill('Public browser request.');
    await expect.poll(() => send.isEnabled(), { timeout: 5000 }).toBe(true); await send.click();
    await expect.poll(() => chat.locator('ol').textContent()).toContain('Public synthetic reply.');
    expect(await chat.locator('ol').textContent()).toContain('Public browser request.');
    expect(await input.inputValue()).toBe('');
    await expect.poll(() => cancel.isEnabled()).toBe(true); await cancel.click();
    await expect.poll(() => chat.locator('ol').textContent()).toContain('Đã ngắt');
    await input.fill('Public preserved draft.');
    await route.call('thread/resume', { threadId: 'missing' });
    await route.call('thread/resume', { threadId: 'thread-1' });
    expect(await input.inputValue()).toBe('Public preserved draft.');
    await route.call('thread/start');
    await expect.poll(() => input.inputValue()).toBe(''); expect(await chat.locator('ol').textContent()).toBe('');
    const snapshot = (await route.call('test/snapshot')).result;
    expect(snapshot.seen.filter(value => value.method === 'turn/start')).toHaveLength(1);
    expect(snapshot.seen.filter(value => value.method === 'turn/interrupt')).toHaveLength(1);
    expect(snapshot.keys).toEqual([]);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    expect(await page.evaluate(() => window.fischLive.metrics().cameraActive)).toBe(false);
    await input.fill('Public reload draft.'); await page.reload().catch(() => {});
    expect(await route.running).toBe(1); expect(route.live.browser.isConnected()).toBe(false);
    expect(route.live.gateway.exitCode !== null || route.live.gateway.signalCode !== null).toBe(true);
    await route.close(); route = await browserRoute();
    const fresh = route.live.page.locator('.fisch-conversation');
    await expect.poll(() => fresh.locator('textarea').isEnabled()).toBe(true);
    expect(await fresh.locator('textarea').inputValue()).toBe(''); expect(await fresh.locator('ol').textContent()).toBe('');
    expect((await route.call('test/snapshot')).result.seen.filter(value => value.method === 'turn/start')).toEqual([]);
  } finally { await route.close(); }
}, 90000);

it.skipIf(!existsSync(gatewayExecutable()) && !requireBrowserGateway)('uses the chat DOM to invoke a scripted agent expression through actual MCP without projecting tool output as chat', async () => {
  const route = await browserRoute({ expression: true }), page = route.live.page;
  try {
    expect(route.ready.tools).toContain('express'); expect(route.ready.tools).toContain('observe');
    const chat = page.locator('.fisch-conversation'), input = chat.locator('textarea');
    await expect.poll(() => input.isEnabled(), { timeout: 5000 }).toBe(true);
    await input.fill(JSON.stringify({ operation: 'express' }));
    await chat.getByRole('button', { name: 'Gửi', exact: true }).click();
    const result = await route.next(value => value.type === 'result' && value.command === 'express');
    expect(result.value.status).toBe('accepted');
    await expect.poll(() => page.evaluate(() => window.fischLive.metrics().scene)).toBe('wall');
    const metrics = await page.evaluate(() => window.fischLive.metrics());
    expect(metrics.diagnostics.events.some(event => event.origin === 'native' && event.phase === 'applied')).toBe(true);
    await expect.poll(() => page.evaluate(() => window.fischLive.metrics().diagnostics.events.some(event =>
      event.origin === 'native' && event.phase === 'frame_changed_proxy'))).toBe(true);
    expect(await chat.locator('ol').textContent()).toBe('');
    expect(metrics.cameraActive).toBe(false);
    if (process.env.FISCH_CHAT_EXPRESSION_SCREENSHOT) await page.screenshot({ path: process.env.FISCH_CHAT_EXPRESSION_SCREENSHOT });
  } finally { await route.close(); }
}, 90000);

const nativeGateway = existsSync(gatewayExecutable());
function mailbox(child) {
  const rows = []; let text = '';
  child.stdout.on('data', chunk => { text += chunk; let end; while ((end = text.indexOf('\n')) >= 0) { rows.push(JSON.parse(text.slice(0,end))); text = text.slice(end+1); if(rows.length>128) rows.shift(); } });
  return async predicate => { let found; await expect.poll(() => { found = rows.find(predicate); return !!found; }, { timeout: 10000 }).toBe(true); return found; };
}
async function nativeBrowserLoop(provider) {
  const live = await openLive({ headless:true, assets:false, production:false, synthetic:true }), abort = new AbortController();
  let child, inbox, serial = 0;
  const running = runTerminalCodex({ live, cwd: process.cwd(), signal: abort.signal, reactiveProvider: provider,
    host: { command:process.execPath, args:[fixture] }, spawnClient: (command,args,settings) => { child=spawn(command,args,{...settings,stdio:['pipe','pipe','pipe']}); child.stderr.resume(); inbox=mailbox(child); return child; } });
  void running.catch(()=>{});
  const close=async()=>{ abort.abort(); child?.stdin.end(); await running.catch(()=>{}); await live.close(); };
  try {
  await expect.poll(()=>typeof inbox).toBe('function'); await inbox(row=>row.type==='ready');
  const call=async(method,params={})=>{ const tag=++serial; child.stdin.write(JSON.stringify({method,params,tag})+'\n'); return (await inbox(row=>row.type==='reply'&&row.tag===tag)).value; };
  await expect.poll(()=>live.page.locator('#enable-reactivity').isEnabled()).toBe(true); await live.page.locator('.camera-options > summary').click(); await live.page.locator('#enable-reactivity').check(); await live.page.keyboard.press('Escape');
  await call('turn/start',{threadId:'thread-1',input:[{type:'text',text:'Public scripted coding task.'}]});
  await live.page.evaluate(()=> { window.__observationMode='absent'; window.__observationTimer=setInterval(()=>window.fischLive.fixture(window.__observationMode),150); });
  return { live,call,close };
  } catch(error) { await close(); throw error; }
}
const authored = request => ({ decision:{schemaVersion:1,requestId:request.requestId,decisionId:'decision_'+request.requestId,mode:'express',validUntil:request.deadline,
  action:{actionId:'action_'+request.requestId,body:{type:'sequence',children:[{type:'parallel',children:[{type:'assemble',parts:[{id:'scripted_reaction',kind:'ellipsoid',center:[0,0,0],scale:[0.4,0.6,0.2]}],durationMs:600}]}]}}},reply:'Lời chủ động từ fixture: chỉ kiểm tra đường truyền, không phải model thật.' });
async function arrive(f) { await f.live.page.waitForTimeout(1300); await f.live.page.evaluate(()=>{window.__observationMode='present';}); }
async function evidence(f, kind) {
  const metrics=await f.live.page.evaluate(()=>window.fischLive.metrics());
  const messages=await f.live.page.locator('.observation-messages').innerText();
  if(process.env.FISCH_NATIVE_OBSERVATION_EVIDENCE){const dir=process.env.FISCH_NATIVE_OBSERVATION_EVIDENCE;mkdirSync(dir,{recursive:true,mode:0o700});await f.live.page.screenshot({path:dir+'/'+kind+'.png'});writeFileSync(dir+'/'+kind+'.json',JSON.stringify({kind,metrics,messages,mainBackend:'scripted-native-protocol-fixture',reactionBackend:kind.startsWith('actual-native')?'signed-in-codex-app-server':'scripted-provider',cameraOrMic:false},null,2));}
  return {metrics,messages};
}
it.skipIf(!nativeGateway)('observes and publishes a causal reaction while the separate coding turn keeps running',async()=>{
  let resolve, seen, calls=0; const published=[];
  const provider={conversationLane:true,contractVersion:1,confirmPublication:(request,receipt)=>published.push({request,receipt}),
    decide:window=>{calls++;seen=window;return new Promise(yes=>{resolve=yes;});}};
  const f=await nativeBrowserLoop(provider);
  try{
    await arrive(f); await expect.poll(()=>calls,{timeout:10000}).toBe(1);
    const before=await f.live.page.evaluate(()=>window.fischLive.metrics()); await f.live.page.waitForTimeout(800);
    const during=await f.live.page.evaluate(()=>window.fischLive.metrics());expect(during.cameraSeq).toBeGreaterThan(before.cameraSeq);expect(during.render.frame).toBeGreaterThan(before.render.frame);
    resolve(authored(seen.request));
    await expect.poll(()=>f.live.page.locator('.observation-messages').innerText(),{timeout:10000}).toContain('Lời chủ động từ fixture');
    await expect.poll(()=>f.live.page.evaluate(()=>window.fischLive.metrics().parts)).toEqual(['scripted_reaction']);
    await expect.poll(()=>published.length).toBe(1);
    expect(published[0]).toMatchObject({request:{requestId:seen.request.requestId},receipt:{source:'native-observation',reason:'accepted',chatPublished:true}});
    await f.live.page.waitForTimeout(1000);expect(calls).toBe(1);
    const state=(await f.call('test/snapshot')).result;expect(state.seen.filter(row=>row.method==='turn/interrupt')).toHaveLength(0);
    const result=await evidence(f,'scripted');expect(result.metrics.cameraActive).toBe(false);
  }finally{await f.close();}
},60000);
it.skipIf(!nativeGateway)('user intent revokes both late reaction text and geometry without interrupting the coding turn',async()=>{
  let resolve,seen,aborted=false;
  const provider={conversationLane:true,contractVersion:1,decide:(window,signal)=>{seen=window;signal.addEventListener('abort',()=>{aborted=true;});return new Promise(yes=>{resolve=yes;});}};
  const f=await nativeBrowserLoop(provider);
  try{
    await arrive(f);await expect.poll(()=>typeof resolve,{timeout:10000}).toBe('function');
    await f.call('turn/steer',{threadId:'thread-1',expectedTurnId:'turn-1',input:[{type:'text',text:'Public user priority intent.'}]});
    await expect.poll(()=>aborted).toBe(true);resolve(authored(seen.request));await f.live.page.waitForTimeout(700);
    expect(await f.live.page.locator('.observation-messages').innerText()).toBe('');expect(await f.live.page.evaluate(()=>window.fischLive.metrics().parts)).not.toContain('scripted_reaction');
    expect((await f.call('test/snapshot')).result.seen.filter(row=>row.method==='turn/interrupt')).toHaveLength(0);
  }finally{await f.close();}
},60000);
function captureNativeInputs(provider) {
  const inputs=[], decide=provider.decide.bind(provider);
  provider.decide=(window,...args)=>{if(inputs.length<4)inputs.push({at:Date.now(),request:structuredClone(window.request),data:reactionObservationData(window)});return decide(window,...args);};
  return inputs;
}
function nativeEvidence(provider, inputs) {
  return { sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), policy:provider.policy,
    clockMapping:{observation:'unix_ms',requestDeadline:'browser_monotonic_ms',captureAt:'host_unix_ms'},inputs,...provider.diagnostics() };
}
const real=process.env.FISCH_RUN_MODEL_TESTS==='1'&&process.env.FISCH_NATIVE_OBSERVATION_REAL==='1';
it.skipIf(!real)('signed-in Codex autonomously chooses a visible conversational reaction from continuous synthetic observations',async()=>{
  const configured=createLiveReactiveProvider({...process.env,FISCH_REACTIVE_BACKEND:'codex'});expect(configured.provider).toBeTruthy(); const inputs=captureNativeInputs(configured.provider);
  const f=await nativeBrowserLoop(configured.provider);
  try{
    await arrive(f);
    await expect.poll(()=>f.live.page.locator('.observation-messages').innerText(),{timeout:90000}).not.toBe('');
    const result=await evidence(f,'actual-native');expect(result.metrics.cameraActive).toBe(false);
    const decision=configured.provider.diagnostics().lastResult;
    expect(decision).toBeTruthy();
    if(decision.selectedMode!=='retain') expect(result.metrics.diagnostics.events.some(row=>row.origin==='reactive'&&['applied','completed'].includes(row.phase))).toBe(true);
    else { expect(decision.selectedMode).toBe('retain'); expect(decision.actionId).toBeNull(); }
  }finally{if(process.env.FISCH_NATIVE_OBSERVATION_EVIDENCE){const dir=process.env.FISCH_NATIVE_OBSERVATION_EVIDENCE;mkdirSync(dir,{recursive:true,mode:0o700});writeFileSync(dir+'/actual-native-diagnostics.json',JSON.stringify(nativeEvidence(configured.provider,inputs),null,2),{mode:0o600});}await f.close();}
},120000);

it.skipIf(!real)('signed-in Codex interruption revokes the observation lane while the coding turn remains owned',async()=>{
  const configured=createLiveReactiveProvider({...process.env,FISCH_REACTIVE_BACKEND:'codex'});expect(configured.provider).toBeTruthy(); const inputs=captureNativeInputs(configured.provider);
  const f=await nativeBrowserLoop(configured.provider);
  try{
    await arrive(f);await expect.poll(()=>configured.provider.active?.turnId,{timeout:60000}).toBeTruthy();
    const before=await f.live.page.evaluate(()=>window.fischLive.metrics());
    await f.call('turn/steer',{threadId:'thread-1',expectedTurnId:'turn-1',input:[{type:'text',text:'Public user interruption.'}]});
    await expect.poll(()=>configured.provider.diagnostics().lastFailure?.code,{timeout:10000}).toBe('native_reaction_aborted');
    await f.live.page.waitForTimeout(700);const after=await f.live.page.evaluate(()=>window.fischLive.metrics());
    expect(after.cameraSeq).toBeGreaterThan(before.cameraSeq);expect(await f.live.page.locator('.observation-messages').innerText()).toBe('');
    expect(after.reactiveOwner).toBeNull();expect((await f.call('test/snapshot')).result.seen.filter(row=>row.method==='turn/interrupt')).toHaveLength(0);
    await evidence(f,'actual-native-interrupted');
  }finally{if(process.env.FISCH_NATIVE_OBSERVATION_EVIDENCE){const dir=process.env.FISCH_NATIVE_OBSERVATION_EVIDENCE;mkdirSync(dir,{recursive:true,mode:0o700});writeFileSync(dir+'/actual-native-interrupted-diagnostics.json',JSON.stringify(nativeEvidence(configured.provider,inputs),null,2),{mode:0o600});}await f.close();}
},120000);
it.skipIf(!nativeGateway)('rejects invalid reaction text before either geometry or caption publication',async()=>{
  const provider={conversationLane:true,contractVersion:1,decide:async window=>({...authored(window.request),reply:[]})};
  const f=await nativeBrowserLoop(provider);
  try{await arrive(f);await expect.poll(()=>f.live.page.evaluate(()=>window.fischLive.reactiveStatus().dispatches),{timeout:10000}).toBe(1);await f.live.page.waitForTimeout(700);
    expect(await f.live.page.locator('.observation-messages').innerText()).toBe('');expect(await f.live.page.evaluate(()=>window.fischLive.metrics().parts)).not.toContain('scripted_reaction');
  }finally{await f.close();}
},60000);

async function protectUserScene(f) {
  const client = liveTestClient(f.live.base, f.live.token);
  try {
    await client.call('initialize');
    const result = toolValue(await client.tool('compose_expression', { base: 'none', durationMs: 100,
      parts: [{ id: 'protected_form', kind: 'ellipsoid', center: [0,0,0], scale: [0.4,0.6,0.2] }] }));
    expect(result.status).toBe('accepted');
    await expect.poll(()=>f.live.page.evaluate(()=>{const m=window.fischLive.metrics();return m.userGeometryLocked&&!m.schedulerBusy&&performance.now()>=m.userLeaseUntil;})).toBe(true);
    return client;
  } catch (error) { await client.close(); throw error; }
}
for (const mode of ['observe','express']) it.skipIf(!nativeGateway)(`keeps a protected custom form while handling a Native ${mode} response`, async()=>{
  const calls=[], receipts=[];
  const provider={conversationLane:true,contractVersion:1,confirmPublication:(_request,receipt)=>receipts.push(receipt),
    decide:async(window,_signal,_receipt,capabilities)=>{calls.push(capabilities);return mode==='express'?authored(window.request):{
      decision:{schemaVersion:1,requestId:window.request.requestId,decisionId:'caption_'+window.request.requestId,mode:'observe',validUntil:window.request.deadline,action:null},
      reply:'Lời fixture bên cạnh hình được giữ; không phải model thật.'};}};
  const f=await nativeBrowserLoop(provider);let client;
  try{
    client=await protectUserScene(f);await arrive(f);
    await expect.poll(()=>calls.length,{timeout:10000}).toBe(1);
    expect(calls[0]).toEqual({schemaVersion:1,expressionAllowed:false});
    await expect.poll(()=>receipts.length,{timeout:10000}).toBe(1);
    expect(receipts[0]).toMatchObject({reason:mode==='observe'?'observed':'admission_failed',chatPublished:mode==='observe'});
    const text=await f.live.page.locator('.observation-messages').innerText();
    if(mode==='observe')expect(text).toContain('Lời fixture');else expect(text).toBe('');
    const metrics=await f.live.page.evaluate(()=>window.fischLive.metrics());
    expect(metrics.parts).toEqual(['protected_form']);expect(metrics.userGeometryLocked).toBe(true);expect(metrics.reactiveOwner).toBeNull();
    expect(metrics.diagnostics.events.some(row=>row.origin==='reactive'&&['admitted','applied'].includes(row.phase))).toBe(false);
    expect(metrics.cameraActive).toBe(false);
  }finally{await client?.close();await f.close();}
},60000);

it.skipIf(!nativeGateway)('keeps raw hand reacquisition while avoiding a duplicate Native request through the production source',async()=>{
  const requests=[];
  const provider={conversationLane:true,contractVersion:1,policy:{deadlineMs:60000,cooldownMs:1000,maxPerMinute:4},decide:async window=>{
    requests.push(window);return {decision:{schemaVersion:1,requestId:window.request.requestId,decisionId:'seen_'+window.request.requestId,
      mode:'observe',validUntil:window.request.deadline,action:null},reply:''};}};
  const f=await nativeBrowserLoop(provider);
  try{
    await f.live.page.evaluate(()=>{window.__observationMode='hand-only';});
    await expect.poll(()=>requests.length,{timeout:10000}).toBe(1);
    await f.live.page.waitForTimeout(1500);
    await f.live.page.evaluate(()=>clearInterval(window.__observationTimer));
    await f.live.page.waitForTimeout(400);
    await f.live.page.evaluate(()=>{window.__observationTimer=setInterval(()=>window.fischLive.fixture(window.__observationMode),150);});
    await expect.poll(async()=>(await f.live.page.locator('#events li').allTextContents()).filter(text=>text.includes('hand_appeared')).length,{timeout:10000}).toBeGreaterThanOrEqual(2);
    await f.live.page.waitForTimeout(1800);expect(requests).toHaveLength(1);
    await f.live.page.evaluate(()=>{window.__observationMode='hand-lost';});
    await f.live.page.waitForTimeout(2000);const beforeReturn=requests.length;
    await f.live.page.evaluate(()=>{window.__observationMode='hand-only';});
    await expect.poll(()=>requests.length,{timeout:10000}).toBe(beforeReturn+1);
    expect(requests.at(-1).events.some(event=>event.type==='hand_appeared')).toBe(true);
    expect((await f.live.page.evaluate(()=>window.fischLive.metrics())).cameraActive).toBe(false);
  }finally{await f.close();}
},60000);

it.skipIf(!nativeGateway)('hands off only an explicitly disposable MAIN form through actual MCP and gateway',async()=>{
  const calls=[],receipts=[];
  const provider={conversationLane:true,contractVersion:1,confirmPublication:(_request,value)=>receipts.push(value),
    decide:async(window,_signal,_receipt,capabilities)=>{calls.push(capabilities);return authored(window.request);}};
  const f=await nativeBrowserLoop(provider),client=liveTestClient(f.live.base,f.live.token);
  try{
    await client.call('initialize');
    const receipt=toolValue(await client.tool('compose_expression',{durationMs:100,observerHandoffMs:30000,
      parts:[{id:'disposable_main_form',kind:'ellipsoid',center:[0,0,0],scale:[0.4,0.6,0.2]}]}));
    expect(receipt.status).toBe('accepted');
    await expect.poll(()=>f.live.page.evaluate(()=>window.fischLive.nativeReactionCapabilities().expressionAllowed)).toBe(true);
    await arrive(f);await expect.poll(()=>receipts.length,{timeout:10000}).toBe(1);
    expect(calls).toEqual([{schemaVersion:1,expressionAllowed:true}]);
    expect(receipts[0]).toMatchObject({reason:'accepted',chatPublished:true});
    const metrics=await f.live.page.evaluate(()=>window.fischLive.metrics());
    expect(metrics.userGeometryLocked).toBe(false);expect(metrics.observerHandoff).toBeNull();
    expect(metrics.parts).not.toContain('disposable_main_form');expect(metrics.cameraActive).toBe(false);
    expect(metrics.diagnostics.events.some(row=>row.origin==='reactive'&&row.phase==='applied')).toBe(true);
  }finally{await client.close();await f.close();}
},60000);

it('carries explicit disposable handoff through existing live compilation and bounds it', async () => {
  const { composeExpression } = await import('../integrations/compose-expression.mjs');
  const { expressionResponseSchema } = await import('../integrations/expression-response.mjs');
  expect(JSON.stringify(expressionResponseSchema)).not.toContain('observerHandoffMs');
  const part = () => ({ id: 'authored', kind: 'ellipsoid', center: [0,0,0], scale: [0.3,0.3,0.1] });
  const { LiveCompiler } = await import('../src/core/live/compiler.ts');
  const output = composeExpression({ parts: [part()], observerHandoffMs: 30000 });
  expect(output.body).toMatchObject({ type: 'live', configuration: { controls: [], poses: [], lifetimeMs: 1000, observerHandoffMs: 30000 } });
  const compiled = new LiveCompiler().compile({ v: 1, epoch: 'test', seq: 1, kind: 'program', track: 'body', ...output }, 0);
  expect(compiled.configuration?.observerHandoffMs).toBe(30000);
  for (const ms of [0, 999, 60001, 1000.5, NaN, Infinity])
    expect(() => composeExpression({ parts: [part()], observerHandoffMs: ms })).toThrow('composition_arguments');
  expect(composeExpression({ parts: [part()] }).body.type).toBe('parallel');
});

it('copies only an explicit bounded public interaction brief in Native capabilities',async()=>{
  const {freezeNativeHostCapabilities}=await import('../integrations/native-reaction-provider.mjs');
  const context={revision:2,text:'Public shared game',mode:'open'};
  const result=freezeNativeHostCapabilities({schemaVersion:1,expressionAllowed:false,interactionContext:context});
  context.text='changed';expect(result.interactionContext.text).toBe('Public shared game');expect(Object.isFrozen(result.interactionContext)).toBe(true);
  let reads=0;
  for(const value of [{schemaVersion:1,interactionContext:context},{expressionAllowed:true,interactionContext:context},
    {schemaVersion:1,expressionAllowed:true,interactionContext:{revision:2,mode:'open',get text(){reads++;return 'hidden';}}},
    ...[{...context,text:'x'.repeat(241)},{...context,text:'bad\nline'},{...context,private:'hidden'},Object.create(context)]
      .map(interactionContext=>({schemaVersion:1,expressionAllowed:true,interactionContext}))])
    expect(()=>freezeNativeHostCapabilities(value)).toThrow('native_host_capabilities_invalid');
  expect(reads).toBe(0);
  const {composeExpression}=await import('../integrations/compose-expression.mjs');
  const {expressionResponseSchema}=await import('../integrations/expression-response.mjs');
  expect(JSON.stringify(expressionResponseSchema)).not.toContain('observerContext');
  const parts=[{id:'public_form',kind:'ellipsoid',center:[0,0,0],scale:[0.3,0.3,0.1]}];
  for(const observerContext of [{text:'',mode:'open',durationMs:1000},{text:'ok',mode:'open',durationMs:60001},{text:'ok',mode:'unknown',durationMs:1000}])
    expect(()=>composeExpression({parts,observerContext})).toThrow('composition_arguments');
});
async function shareInteraction(f,mode='open',durationMs=60000,handoff=false){
  const client=liveTestClient(f.live.base,f.live.token);await client.call('initialize');
  const receipt=toolValue(await client.tool('compose_expression',{durationMs:100,...(handoff?{observerHandoffMs:60000}:{}),
    observerContext:{text:'Public game: continue the shared activity without assuming an answer.',mode,durationMs},
    parts:[{id:'shared_game_form',kind:'ellipsoid',center:[0,0,0],scale:[0.4,0.6,0.2]}]}));
  expect(receipt.status).toBe('accepted');return client;
}
it.skipIf(!nativeGateway)('shares only explicit public context while retaining independent scene protection',async()=>{
  const calls=[],receipts=[];
  const provider={conversationLane:true,contractVersion:1,confirmPublication:(_request,value)=>receipts.push(value),
    decide:async(window,_signal,_receipt,capabilities)=>{calls.push(capabilities);return {decision:{schemaVersion:1,requestId:window.request.requestId,
      decisionId:'context_'+window.request.requestId,mode:'observe',validUntil:window.request.deadline,action:null},reply:'Scripted continuation of the public activity.'};}};
  const f=await nativeBrowserLoop(provider);let client;
  try{client=await shareInteraction(f);await arrive(f);await expect.poll(()=>receipts.length,{timeout:10000}).toBe(1);
    expect(calls[0]).toMatchObject({expressionAllowed:false,interactionContext:{mode:'open',text:'Public game: continue the shared activity without assuming an answer.'}});
    expect(JSON.stringify(calls[0])).not.toContain('Public scripted coding task');
    expect(await f.live.page.locator('.observer-context').innerText()).toContain('Public game:');
    expect(receipts[0]).toMatchObject({reason:'observed',chatPublished:true});
    const metrics=await f.live.page.evaluate(()=>window.fischLive.metrics());expect(metrics.parts).toEqual(['shared_game_form']);expect(metrics.userGeometryLocked).toBe(true);
  }finally{await client?.close();await f.close();}
},60000);
for(const mode of ['observe','express'])it.skipIf(!nativeGateway)(`drops a late ${mode} result whose public interaction context expired`,async()=>{
  let resolve,request;const receipts=[];
  const provider={conversationLane:true,contractVersion:1,confirmPublication:(_request,value)=>receipts.push(value),
    decide:window=>{request=window.request;return new Promise(yes=>{resolve=yes;});}};
  const f=await nativeBrowserLoop(provider);let client;
  try{client=await shareInteraction(f,'open',5000,true);await arrive(f);await expect.poll(()=>typeof resolve,{timeout:10000}).toBe('function');
    await expect.poll(()=>f.live.page.evaluate(()=>window.fischLive.nativeReactionCapabilities().interactionContext??null),{timeout:8000}).toBeNull();
    const late=mode==='express'?authored(request):{decision:{schemaVersion:1,requestId:request.requestId,decisionId:'late_context',mode:'observe',validUntil:request.deadline,action:null},reply:'STALE_PUBLIC_CONTEXT_CANARY'};
    const drop=await f.live.page.evaluate(({id,data})=>window.fischLive.deliverNativeReaction(id,data),{id:request.requestId,data:late});
    expect(drop).toMatchObject({reason:'interaction_context_expired',chatPublished:false});resolve(late);
    await f.live.page.waitForTimeout(700);
    expect(await f.live.page.locator('.observation-messages').innerText()).toBe('');
    const metrics=await f.live.page.evaluate(()=>window.fischLive.metrics());expect(metrics.parts).toEqual(['shared_game_form']);expect(metrics.reactiveOwner).toBeNull();
    expect(metrics.diagnostics.events.some(row=>row.origin==='reactive'&&row.phase==='admitted')).toBe(false);
  }finally{await client?.close();await f.close();}
},60000);
it.skipIf(!nativeGateway)('enforces a finite explicit quiet window without inventing a quiet request from text',async()=>{
  let calls=0;const provider={conversationLane:true,contractVersion:1,decide:async()=>{calls++;throw Error('unexpected_quiet_inference');}};
  const f=await nativeBrowserLoop(provider);let client;
  try{client=await shareInteraction(f,'quiet',10000);await arrive(f);await f.live.page.waitForTimeout(2500);
    expect(calls).toBe(0);expect(await f.live.page.locator('.observer-context').innerText()).toContain('tạm yên lặng');
    await expect.poll(()=>f.live.page.evaluate(()=>window.fischLive.nativeReactionCapabilities().interactionContext??null),{timeout:12000}).toBeNull();
    expect(calls).toBe(0);expect(await f.live.page.locator('.observation-messages').innerText()).toBe('');
    expect((await f.live.page.evaluate(()=>window.fischLive.metrics())).parts).toEqual(['shared_game_form']);
  }finally{await client?.close();await f.close();}
},60000);

it.skipIf(!nativeGateway)('rejects observer-authored context even when MAIN granted disposable geometry',async()=>{
  const receipts=[];const provider={conversationLane:true,contractVersion:1,confirmPublication:(_request,value)=>receipts.push(value),
    decide:async window=>{const result=authored(window.request);result.decision.action.body={type:'live',program:result.decision.action.body,
      configuration:{controls:[],poses:[],lifetimeMs:1000,observerContext:{text:'FORGED_CONTEXT_CANARY',mode:'open',durationMs:60000}}};return result;}};
  const f=await nativeBrowserLoop(provider);let client;
  try{client=await shareInteraction(f,'open',60000,true);await arrive(f);await expect.poll(()=>receipts.length,{timeout:10000}).toBe(1);
    expect(receipts[0]).toMatchObject({reason:'admission_failed',chatPublished:false});
    expect(await f.live.page.locator('.observation-messages').innerText()).toBe('');
    expect(await f.live.page.locator('.observer-context').innerText()).not.toContain('FORGED_CONTEXT_CANARY');
    const metrics=await f.live.page.evaluate(()=>window.fischLive.metrics());expect(metrics.parts).toEqual(['shared_game_form']);expect(metrics.userGeometryLocked).toBe(true);
  }finally{await client?.close();await f.close();}
},60000);

it.skipIf(!nativeGateway)('keeps a long public brief above usable chat with published fixture captions across desktop and mobile without losing drafts',async()=>{
  let calls=0;const receipts=[];
  const provider={conversationLane:true,contractVersion:1,policy:{deadlineMs:60000,cooldownMs:1000,maxPerMinute:4},confirmPublication:(_request,value)=>receipts.push(value),
    decide:async window=>{calls++;return{decision:{schemaVersion:1,requestId:window.request.requestId,decisionId:'layout_'+window.request.requestId,mode:'observe',validUntil:window.request.deadline,action:null},
      reply:'Bản chiếu bố cục tổng hợp, không phải lượt model. '.repeat(3)};}};
  const f=await nativeBrowserLoop(provider);let client;
  try{
    await f.call('turn/interrupt',{threadId:'thread-1',turnId:'turn-1'});
    client=liveTestClient(f.live.base,f.live.token);await client.call('initialize');
    const text='Ngữ cảnh công khai của trò chơi: '.repeat(12).slice(0,239)+'!';
    expect(toolValue(await client.tool('compose_expression',{durationMs:100,observerContext:{text,mode:'open',durationMs:60000},
      parts:[{id:'layout_form',kind:'ellipsoid',center:[0,0,0],scale:[0.3,0.3,0.1]}]})).status).toBe('accepted');
    const page=f.live.page,input=page.locator('.fisch-conversation textarea'),brief=page.locator('.observer-context');
    await expect.poll(()=>brief.innerText()).toContain(text);
    await page.evaluate(()=>{window.__observationMode='present-neutral';});await expect.poll(()=>receipts.length,{timeout:10000}).toBe(1);
    await page.evaluate(()=>{window.__observationMode='present-smile';});await expect.poll(()=>receipts.length,{timeout:10000}).toBe(2);
    expect(receipts.every(receipt=>receipt.chatPublished===true)).toBe(true);expect(await page.locator('.observation-messages > div').count()).toBe(2);
    if(process.env.FISCH_BRIEF_LAYOUT_EVIDENCE)writeFileSync(process.env.FISCH_BRIEF_LAYOUT_EVIDENCE+'/publication.json',JSON.stringify({actualModelCalls:0,mainBackend:'Native protocol fixture',observerBackend:'scripted provider',fakeProviderCalls:calls,captionRows:2,receipts},null,2));
    await input.fill('Bản nháp phải còn nguyên khi brief đếm ngược.');
    for(const[width,height]of[[1360,950],[1440,900],[1280,720],[390,844],[320,568],[844,390],[640,450]]){
      await page.setViewportSize({width,height});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
      const layout=await page.evaluate(()=>{
        const host=document.querySelector('#conversation-tools').getBoundingClientRect(),brief=document.querySelector('.observer-context').getBoundingClientRect();
        const nodes=['.fisch-conversation','.fisch-conversation ol','.fisch-conversation textarea','.fisch-conversation button[type=submit]','.fisch-conversation button[type=button]'];
        return{width:innerWidth,height:innerHeight,host:{x:host.x,y:host.y,right:host.right,bottom:host.bottom,width:host.width},brief:{x:brief.x,right:brief.right,bottom:brief.bottom,width:brief.width},
          nodes:nodes.map(selector=>{const element=document.querySelector(selector),r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return{selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,lineHeight:parseFloat(getComputedStyle(element).lineHeight),padding:parseFloat(getComputedStyle(element).paddingTop)+parseFloat(getComputedStyle(element).paddingBottom),hit:hit===element||element.contains(hit)};})};
      });
      if(process.env.FISCH_BRIEF_LAYOUT_EVIDENCE){writeFileSync(process.env.FISCH_BRIEF_LAYOUT_EVIDENCE+`/layout-${width}x${height}.json`,JSON.stringify(layout,null,2));if([1360,390,320].includes(width))await page.screenshot({path:process.env.FISCH_BRIEF_LAYOUT_EVIDENCE+`/brief-${width}x${height}.png`});}
      for(const node of layout.nodes){expect(node.x).toBeGreaterThanOrEqual(layout.host.x-1);expect(node.right).toBeLessThanOrEqual(Math.min(layout.host.right,layout.width)+1);expect(node.bottom).toBeLessThanOrEqual(Math.min(height,layout.host.bottom)+1);expect(node.height,`${width}x${height} ${node.selector} ${JSON.stringify(layout)}`).toBeGreaterThan(0);}
      for(const node of layout.nodes.slice(0,3))expect(node.width).toBeGreaterThanOrEqual(layout.host.width*.9);
      expect(layout.brief.bottom).toBeLessThanOrEqual(layout.nodes[0].y+1);
      for(const node of layout.nodes.slice(2))expect(node.hit).toBe(true);
      expect(await input.inputValue()).toBe('Bản nháp phải còn nguyên khi brief đếm ngược.');
      expect(layout.nodes[1].height).toBeGreaterThanOrEqual(layout.nodes[1].lineHeight);expect(layout.nodes[2].height).toBeGreaterThanOrEqual(layout.nodes[2].lineHeight*2+layout.nodes[2].padding);
      expect(layout.brief.x).toBeGreaterThanOrEqual(layout.host.x-1);expect(layout.brief.right).toBeLessThanOrEqual(layout.host.right+1);
    }
    await brief.focus();await page.keyboard.press('End');
    await expect.poll(()=>brief.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);await page.waitForTimeout(1100);
    expect(await brief.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);expect(await brief.textContent()).toContain(text);
    const reaction=page.locator('.observation-messages');await reaction.focus();await page.keyboard.press('End');await expect.poll(()=>reaction.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
    expect(await input.inputValue()).toBe('Bản nháp phải còn nguyên khi brief đếm ngược.');expect(calls).toBe(2);
    const replace=async durationMs=>toolValue(await client.tool('compose_expression',{durationMs:100,observerContext:{text,mode:'open',durationMs},
      parts:[{id:'layout_form',kind:'ellipsoid',center:[0,0,0],scale:[0.3,0.3,0.1]}]}));
    expect((await replace(1000)).status).toBe('accepted');await expect.poll(()=>brief.isVisible(),{timeout:6000}).toBe(false);
    expect(await brief.textContent()).toBe('');expect(await input.inputValue()).toBe('Bản nháp phải còn nguyên khi brief đếm ngược.');
    await page.locator('.fisch-conversation button[type=submit]').click();
    await expect.poll(async()=>(await f.call('test/snapshot')).result.seen.filter(row=>row.method==='turn/start').length).toBe(2);
    expect((await f.call('test/snapshot')).result.seen.filter(row=>row.method==='turn/start').at(-1).text).toBe('Bản nháp phải còn nguyên khi brief đếm ngược.');
    expect((await replace(60000)).status).toBe('accepted');await expect.poll(()=>brief.isVisible()).toBe(true);
    await page.locator('#stop-all').click();expect(await brief.isVisible()).toBe(false);expect(await brief.textContent()).toBe('');
    expect((await page.evaluate(()=>window.fischLive.metrics())).cameraActive).toBe(false);
  }finally{await client?.close();await f.close();}
},90000);

it.skipIf(!nativeGateway)('returns public Fisch history with strict inspect and best-effort observe diagnostics',async()=>{
  const receipts=[];const provider={conversationLane:true,contractVersion:1,confirmPublication:(_request,value)=>receipts.push(value),
    decide:async window=>({decision:{schemaVersion:1,requestId:window.request.requestId,decisionId:'public_'+window.request.requestId,
      mode:'observe',validUntil:window.request.deadline,action:null},reply:'Bạn chọn lối trái hay lối phải? PUBLIC_QUESTION'})};
  const f=await nativeBrowserLoop(provider),client=liveTestClient(f.live.base,f.live.token);
  const publicHistory=coordination=>{
    expect(coordination).toMatchObject({schemaVersion:1,source:'fisch-host',available:true,state:{schemaVersion:1}});
    expect(coordination.state.recentPublished[0].text).toContain('PUBLIC_QUESTION');
    expect(JSON.stringify(coordination)).not.toContain('Public scripted coding task');
  };
  const unavailable=coordination=>{
    expect(coordination.available).toBe(false);expect(coordination.state).toBeUndefined();
    expect(['timeout','rate_limited','disconnected','epoch_changed','invalid_response','refresh_unavailable','request_failed']).toContain(coordination.reasonCode);
    expect(Number.isInteger(coordination.elapsedMs)).toBe(true);expect(coordination.elapsedMs).toBeGreaterThanOrEqual(0);expect(coordination.elapsedMs).toBeLessThanOrEqual(60000);
  };
  try{await client.call('initialize');await arrive(f);await expect.poll(()=>receipts.length,{timeout:10000}).toBe(1);
    expect(receipts[0].chatPublished).toBe(true);
    const inspected=toolValue(await client.tool('inspect_expression'));publicHistory(inspected.coordination);
    expect(inspected.coordination.epoch).toBe(inspected.epoch);expect(inspected.coordination.session).toBe(inspected.session);
    await f.live.page.waitForTimeout(1100);
    const feedback=toolValue(await client.tool('observe'));expect(feedback.snapshot).toBeTruthy();expect(feedback.snapshot.summary).not.toContain('PUBLIC_QUESTION');
    if(process.env.FISCH_FEEDBACK_OBSERVE_EVIDENCE)writeFileSync(process.env.FISCH_FEEDBACK_OBSERVE_EVIDENCE,JSON.stringify({actualModelCalls:0,attempts:1,timeoutMs:750,available:feedback.coordination.available,reasonCode:feedback.coordination.reasonCode,elapsedMs:feedback.coordination.elapsedMs}));
    if(feedback.coordination.available){publicHistory(feedback.coordination);expect(feedback.coordination.epoch).toBe(inspected.epoch);expect(feedback.coordination.session).toBe(inspected.session);}
    else unavailable(feedback.coordination);
    await f.live.page.waitForTimeout(1100);
    publicHistory(toolValue(await client.tool('inspect_expression')).coordination);
    const collision=toolValue(await client.tool('observe'));unavailable(collision.coordination);expect(collision.coordination.reasonCode).toBe('rate_limited');expect(collision.snapshot).toBeTruthy();
    await f.live.page.evaluate(()=>window.fischLive.conversationClear());await f.live.page.waitForTimeout(1100);
    const cleared=toolValue(await client.tool('inspect_expression'));expect(cleared.coordination.available).toBe(true);expect(cleared.coordination.state.recentPublished).toEqual([]);
    expect(await f.live.page.locator('#look-indicator').isVisible()).toBe(true);
    await f.live.page.waitForTimeout(1100);await client.tool('observe');await f.live.page.waitForTimeout(1000);
    expect(await f.live.page.locator('#look-indicator').isHidden()).toBe(true);
    expect((await f.live.page.evaluate(()=>window.fischLive.metrics())).cameraActive).toBe(false);
  }finally{await client.close();await f.close();}
},60000);


function desktopObserverFixture() {
  let options, scheduled;
  const provider = { conversationLane: true, discardPublication: vi.fn() };
  const broker = { provider, active: { id: 'pending', controller: { abort: vi.fn() } },
    evaluate: vi.fn(async (fn, value) => fn(value)), poll: vi.fn(async () => {}), close: vi.fn() };
  const control = { base: 'http://127.0.0.1:2345', busy: vi.fn(() => false), close: vi.fn(async () => {}) };
  const api = { reactiveUserIntent: vi.fn(), externalObserverStatus: vi.fn() };
  const configure = vi.fn(() => ({ provider, reason: 'ready_native_conversation' }));
  vi.stubGlobal('window', { fischLive: api });
  return { provider, broker, control, api, configure, getOptions: () => options, scheduled: () => scheduled,
    input: { live: { page: { isClosed: () => false }, token: 'synthetic' }, env: {}, configure,
      intentServer: vi.fn(async value => { options = value; return control; }),
      brokerFactory: vi.fn(() => broker), schedule: vi.fn(fn => { scheduled = fn; return 123; }), unschedule: vi.fn(), log: vi.fn() } };
}
it('prepares one default Native provider and polls without inventing main activity or a conversation', async () => {
  const f = desktopObserverFixture();
  try {
    const observer = await startDesktopObserver(f.input);
    expect(f.configure).toHaveBeenCalledExactlyOnceWith(f.input.env, { defaultNative: true });
    expect(f.api.externalObserverStatus).toHaveBeenCalledWith('ready');
    expect(f.broker.poll).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(observer.controlBase).toBe(f.control.base);
    expect(f.input.brokerFactory.mock.calls[0][0].output).toBeUndefined();
    await observer.close(); await observer.close();
    expect(f.broker.close).toHaveBeenCalledOnce(); expect(f.control.close).toHaveBeenCalledOnce();
    expect(f.input.unschedule).toHaveBeenCalledWith(123);
  } finally { vi.unstubAllGlobals(); }
});
it('fences pending output at the known MCP boundary and pauses observer on uncertainty', async () => {
  const f = desktopObserverFixture();
  try {
    const observer = await startDesktopObserver(f.input);
    await f.getOptions().onBegin();
    expect(f.broker.active.controller.abort).toHaveBeenCalledOnce();
    expect(f.provider.discardPublication).toHaveBeenCalledWith('pending');
    expect(f.api.reactiveUserIntent).toHaveBeenCalledOnce();
    f.getOptions().onUncertain(); expect(f.broker.paused).toBe(true);
    await observer.close();
  } finally { vi.unstubAllGlobals(); }
});
it('retains explicit off/failure reasons and cleans resources on startup failure', async () => {
  const f = desktopObserverFixture(); f.configure.mockReturnValue({ provider: null, reason: 'disabled_by_config' });
  try {
    const observer = await startDesktopObserver(f.input);
    expect(f.api.externalObserverStatus).toHaveBeenCalledWith('disabled_by_config'); await observer.close();
    f.broker.evaluate.mockRejectedValue(Error('browser_failed'));
    await expect(startDesktopObserver(f.input)).rejects.toThrow('browser_failed');
    expect(f.control.close).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
it('broker external polling does not publish fake Native activity and respects an outstanding MCP lease', async () => {
  const api = { activity: vi.fn(() => { throw Error('no Native activity source'); }), configureReactive: vi.fn(),
    setReactiveUserBusy: vi.fn(), takeReactiveRequest: vi.fn(() => null) };
  vi.stubGlobal('window', { fischLive: api });
  const broker = new LiveReactiveBroker({ page: { evaluate: async (fn, arg) => fn(arg) },
    provider: { conversationLane: true, close: vi.fn() }, externalBusy: () => true });
  try {
    await broker.poll(undefined);
    expect(broker.browserUnavailable).toBe(false); expect(api.activity).not.toHaveBeenCalled();
    expect(api.setReactiveUserBusy).toHaveBeenCalledWith(true); expect(api.takeReactiveRequest).not.toHaveBeenCalled();
  } finally { broker.close(); vi.unstubAllGlobals(); }
});

async function externalMcpObserver() {
  const live = await openLive({ headless: true, assets: false, synthetic: true, inspect: async page => page.addInitScript(() => {
    window.fixtureMediaRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.fixtureMediaRequests++; throw Error('real_media_forbidden'); };
  }) });
  const state = { response: Promise.withResolvers(), ack: Promise.withResolvers(), entered: false, autoReleased: false };
  const provider = { conversationLane: true, contractVersion: 1, policy: { deadlineMs: 60000, cooldownMs: 1000, maxPerMinute: 4 },
    decide: vi.fn((window, signal) => { state.request = window.request; state.signal = signal; return state.response.promise; }), close: vi.fn() };
  const observer = await startDesktopObserver({ live, configured: { provider, reason: 'ready_native_conversation' }, intentServer: options =>
    startDesktopIntentServer({ ...options, onBegin: async value => {
      await options.onBegin(value); state.entered = true;
      const timer = setTimeout(() => { state.autoReleased = true; state.ack.resolve(); }, 500);
      try { await state.ack.promise; } finally { clearTimeout(timer); }
    } }) });
  const client = liveTestClient(live.base, live.token, { env: { FISCH_MCP_REQUIRE_THREAD: '1', FISCH_DESKTOP_INTENT_BASE: observer.controlBase } });
  const tool = async (name, args = {}) => toolValue(await client.call('tools/call', { name, arguments: args, _meta: { threadId: 'fixture-external-owner' } }));
  const close = async () => {
    state.ack.resolve(); state.response.resolve(null);
    await live.page.evaluate(() => clearInterval(window.fixtureSource)).catch(() => {});
    await observer.close(); await client.close(); await live.close();
  };
  try {
    await client.call('initialize'); await tool('bind_controller'); await tool('observe');
    await live.page.waitForFunction(() => window.fischLive.metrics().diagnostics.events.some(event => event.epoch && !['local', 'idle'].includes(event.epoch)));
    return { live, state, provider, observer, tool, close };
  } catch (error) { await close(); throw error; }
}
function scriptedObserverExpression(request, reply) {
  return { reply, decision: { schemaVersion: 1, requestId: request.requestId, decisionId: 'fixture_old_decision',
    mode: 'express', validUntil: request.deadline, action: { actionId: 'fixture_old_action', body: composeExpression({ durationMs: 300,
      parts: [{ id: 'fixture_old_form', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.3, 0.3, 0.3] }], style: { color: '#00ff00' } }).body } } };
}
const requireGateway = process.env.FISCH_CAPABILITY_REQUIRE_GATEWAY === '1';
it.skipIf(!existsSync(gatewayExecutable()) && !requireGateway)('publishes one scripted external-host observation with actual renderer admission and duplicate fencing', async () => {
  expect(existsSync(gatewayExecutable()), 'Build the standalone gateway for required E2E').toBe(true);
  const f = await externalMcpObserver();
  try {
    const before = await f.live.page.evaluate(() => window.fischLive.metrics());
    await f.live.page.evaluate(() => { window.fixtureSource = setInterval(() => window.fischLive.fixture('present-neutral'), 150); });
    await expect.poll(() => f.state.request, { timeout: 10000 }).toBeTruthy();
    const value = scriptedObserverExpression(f.state.request, 'FIXTURE proactive caption'); f.state.response.resolve(value);
    await expect.poll(() => f.live.page.locator('.observation-messages').textContent(), { timeout: 10000 }).toContain(value.reply);
    const events = () => f.live.page.evaluate(id => window.fischLive.metrics().diagnostics.events.filter(event => event.requestId === id), f.state.request.requestId);
    await expect.poll(async () => (await events()).map(event => event.phase), { timeout: 5000 }).toContain('completed');
    for (const phase of ['admitted', 'applied', 'frame_submitted', 'completed']) expect((await events()).some(event => event.phase === phase)).toBe(true);
    expect((await events()).filter(event => event.phase === 'applied')).toHaveLength(1);
    await f.live.page.evaluate(({ id, value }) => window.fischLive.deliverNativeReaction(id, value), { id: f.state.request.requestId, value });
    const captions = await f.live.page.locator('.observation-messages').textContent();
    expect(captions.split(value.reply)).toHaveLength(2); expect((await events()).filter(event => event.phase === 'applied')).toHaveLength(1);
    const inspection = await f.tool('inspect_expression');
    expect(inspection.epoch).toBe(f.state.request.epoch); expect(inspection.summary.color).toBe('#00ff00');
    const final = await f.live.page.evaluate(() => ({ metrics: window.fischLive.metrics(), media: window.fixtureMediaRequests }));
    expect(final.media).toBe(0); expect(final.metrics.cameraActive).toBe(false);
    expect(final.metrics.cameraSeq).toBeGreaterThan(before.cameraSeq); expect(final.metrics.render.frame).toBeGreaterThan(before.render.frame);
    expect(f.provider.decide).toHaveBeenCalledOnce();
  } finally { await f.close(); }
  expect(f.provider.close).toHaveBeenCalledOnce();
}, 60000);
it.skipIf(!existsSync(gatewayExecutable()) && !requireGateway)('fences a held observer before the real MCP begin ACK in the same renderer epoch', async () => {
  expect(existsSync(gatewayExecutable()), 'Build the standalone gateway for required E2E').toBe(true);
  const f = await externalMcpObserver();
  try {
    await f.live.page.evaluate(() => { window.fixtureSource = setInterval(() => window.fischLive.fixture('present-neutral'), 150); });
    await expect.poll(() => f.state.request, { timeout: 10000 }).toBeTruthy();
    const before = await f.live.page.evaluate(() => window.fischLive.metrics());
    const mutation = f.tool('compose_expression', { requestId: 'fixture_external_mutation', durationMs: 300,
      parts: [{ id: 'fixture_user_form', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.5, 0.4, 0.3] }], style: { color: '#ff36bf', pointSize: 3 } });
    void mutation.catch(() => {});
    await expect.poll(() => f.state.entered, { timeout: 1500 }).toBe(true);
    expect(f.state.signal.aborted).toBe(true); f.state.response.resolve(scriptedObserverExpression(f.state.request, 'FIXTURE STALE REPLY'));
    await expect.poll(() => f.observer.broker.active, { timeout: 1000 }).toBeUndefined();
    const blocked = await f.live.page.evaluate(() => ({ events: window.fischLive.metrics().diagnostics.events,
      captions: document.querySelector('.observation-messages').textContent, media: window.fixtureMediaRequests }));
    expect(blocked.captions).not.toContain('FIXTURE STALE'); expect(blocked.media).toBe(0);
    expect(blocked.events.some(event => event.origin === 'native' && event.phase === 'received')).toBe(false);
    expect(blocked.events.some(event => event.requestId === f.state.request.requestId && ['admitted', 'applied', 'frame_submitted'].includes(event.phase))).toBe(false);
    expect(f.state.autoReleased).toBe(false); f.state.ack.resolve();
    const receipt = await mutation; expect(receipt.status).toBe('accepted'); expect(receipt.epoch).toBe(f.state.request.epoch);
    await expect.poll(async () => (await f.tool('expression_status', { requestId: receipt.requestId })).status, { timeout: 12000 }).toBe('completed');
    const final = await f.live.page.evaluate(() => window.fischLive.metrics());
    expect(final.userGeometryLocked).toBe(true); expect(final.parts).toContain('fixture_user_form');
    expect(final.cameraSeq).toBeGreaterThan(before.cameraSeq); expect(final.render.frame).toBeGreaterThan(before.render.frame);
    expect(f.provider.decide).toHaveBeenCalledOnce();
  } finally { await f.close(); }
  expect(f.provider.close).toHaveBeenCalledOnce();
}, 60000);
