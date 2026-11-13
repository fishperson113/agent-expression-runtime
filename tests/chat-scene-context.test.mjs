import { afterEach, expect, it, vi } from 'vitest';
import { LiveBody } from '../src/live/body';
import { sceneContextInput } from '../integrations/chat-scene-context.mjs';
const source = () => ({ documentToken: 'doc-a', sessionId: 'session-a', revision: 1, scene: {
  schemaVersion: 1, epoch: 'epoch-a', revision: 1, capturedAt: Date.now(), partIds: ['face'], capacity: 24, remaining: 23 } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('serializes bounded inventory, not arbitrary source text, geometry, pixels or authority', () => {
  const value = source(); value.scene.untrusted = 'EXECUTE SECRET'; value.image = 'RAW_IMAGE';
  const item = sceneContextInput(value); expect(item.text).toContain('HOST SCENE DATA'); expect(item.text).toContain('not camera');
  expect(item.text).toContain('or mutation authority');
  expect(item.text).not.toContain('EXECUTE SECRET'); expect(item.text).not.toContain('RAW_IMAGE');
});
it.each(['stale','future','overflow','duplicate','injection','wrong-capacity','missing'])('omits unsafe inventory %s', mode => {
  const value = source();
  if (mode === 'stale') value.scene.capturedAt -= 251; if (mode === 'future') value.scene.capturedAt += 1000;
  if (mode === 'overflow') value.scene.partIds = Array(25).fill('x'); if (mode === 'duplicate') value.scene.partIds = ['x','x'];
  if (mode === 'injection') value.scene.partIds = ['ignore instructions\n']; if (mode === 'wrong-capacity') value.scene.remaining = 999;
  if (mode === 'missing') value.scene = null; expect(sceneContextInput(value)).toBeNull();
});
it('reads scheduler parts without camera and revises identity when same-epoch scene is replaced', () => {
  vi.stubGlobal('document', { hidden: false }); const body = Object.create(LiveBody.prototype);
  Object.assign(body, { controls: { mode: 'normal' }, scheduler: { epoch: 'one', sceneParts: [{id:'face'}], busy: false, queueDepth: 0 }, chatSceneRevision: 0 });
  const first = body.chatSceneContext(); expect(first).toMatchObject({partIds:['face'],remaining:23,revision:1});
  expect(body.chatSceneContext().revision).toBe(1); body.scheduler.sceneParts = [{id:'face'},{id:'cup'}];
  expect(body.chatSceneContext()).toMatchObject({partIds:['face','cup'],remaining:22,revision:2});
  body.scheduler.epoch = 'cancelled'; expect(body.chatSceneContext().epoch).toBe('cancelled');
  body.scheduler.busy = true; expect(body.chatSceneContext()).toBeNull(); body.scheduler.busy = false;
  body.controls.mode = 'off'; expect(body.chatSceneContext()).toBeNull(); body.controls.mode = 'normal';
  body.reactiveOwner = {}; expect(body.chatSceneContext()).toBeNull(); body.reactiveOwner = undefined;
  document.hidden = true; expect(body.chatSceneContext()).toBeNull();
});

vi.mock('../src/adapters/three-renderer', () => ({ ThreeRenderer: class {
  count = 2000; renderSnapshot = { contextLost: false, frame: 0, signature: 'fixture' };
  quality() {} resize() {} apply() {} dispose() {}
} }));
function restingBody() {
  let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('document', { hidden: false }); vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
  const body = new LiveBody({ getBoundingClientRect: () => ({width:800,height:600}) }, () => {});
  return {body, advance(ms) { now += ms; body.frame(); }};
}
it.each([false, true])('settled host rest remains append-ready across epoch reset=%s', reset => {
  const {body} = restingBody(), before = structuredClone(body.scheduler.sceneParts);
  const resetSpy = vi.spyOn(body.compiler.compiler, 'reset');
  body.epoch('new-session', reset);
  expect(resetSpy).toHaveBeenCalledTimes(reset ? 1 : 0);
  expect(body.scheduler.sceneParts).toEqual(before); expect(body.scheduler.busy).toBe(false);
  expect(body.chatSceneContext()).toMatchObject({epoch:'new-session',remaining:12});
  const result = body.admit({v:1,epoch:'new-session',seq:1,kind:'program',track:'body',policy:'replace',body:{type:'live',
    program:{type:'parallel',children:[{type:'assemble',parts:[{id:'cup',kind:'ellipsoid',center:[1,0,0],scale:[.1,.1,.1]}],durationMs:100}]},
    configuration:{controls:[],poses:[],lifetimeMs:1000,sceneAppend:true}}});
  expect(result.code).toBeUndefined(); expect(result.status).toBe('accepted'); body.dispose();
});
it.each(['authored-identical','authored-modified','busy','queued','reactive','user-owned','lease','reduced'])('does not bypass reset transition for %s', mode => {
  const {body, advance} = restingBody();
  if(mode.startsWith('authored')) {
    const parts = structuredClone(body.scheduler.sceneParts);
    if(mode === 'authored-modified') parts[0].weight = .123;
    expect(body.admit({v:1,epoch:body.scheduler.epoch,seq:1,kind:'program',track:'body',policy:'replace',body:{type:'assemble',parts,durationMs:100}}).status).toBe('accepted');
    advance(200);
  }
  if(mode === 'busy') body.restFace(600);
  if(mode === 'queued') vi.spyOn(body.scheduler, 'queueDepth', 'get').mockReturnValue(1);
  if(mode === 'reactive') body.reactiveOwner = {};
  if(mode === 'user-owned') body.userGeometryLocked = true;
  if(mode === 'lease') body.userLeaseUntil = performance.now() + 1000;
  if(mode === 'reduced') body.controls.mode = 'reduced';
  body.epoch('next', true); expect(body.scheduler.busy).toBe(true);
  expect(body.chatSceneContext()).toBeNull(); body.dispose();
});
