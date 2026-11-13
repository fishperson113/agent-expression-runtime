import { afterEach, expect, it, vi } from 'vitest';
import { LiveBody } from '../src/live/body';
import { LiveCompiler } from '../src/core/live/compiler';
import { appendScene } from '../src/core/live/scene-extension';
import type { Part } from '../src/core/geometry/types';
vi.mock('../src/adapters/three-renderer', () => ({ ThreeRenderer: class {
  count = 2000; reducedMotion = false; renderSnapshot = { contextLost: false, frame: 0, signature: 'fixture' };
  quality() {} resize() {} apply() {} dispose() {}
} }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const part = (id: string): Part => ({ id, kind: 'ellipsoid', center: [0,0,0], scale: [.2,.3,.1], motion: {
  pivot: [0,0,0], translate: [.1,0,0], rotate: [0,0,.1], periodMs: 2000, phase: 0 } });
const record = (parts: Part[], seq = 2, append = true): any => ({ v:1, epoch:'idle', seq, kind:'program', track:'body', policy:'replace', body: {
  type:'live', program:{type:'parallel',children:[{type:'assemble',parts,durationMs:100}]},
  configuration:{controls:[],poses:[],lifetimeMs:1000,...(append?{sceneAppend:true}:{})} } });
function setup() {
  let now = 1000, hidden = false;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('document', { get hidden() { return hidden; } }); vi.stubGlobal('devicePixelRatio',1);
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',()=>1); vi.stubGlobal('cancelAnimationFrame',()=>{});
  const body = new LiveBody({getBoundingClientRect:()=>({width:800,height:600})} as HTMLCanvasElement,()=>{});
  const send = (r:any) => body.admit({...r,epoch:body.scheduler.epoch});
  const advance = (ms:number) => {now+=ms;(body as any).frame();};
  advance(1000); expect(send(record([part('custom')],1,false)).status).toBe('accepted'); advance(200);
  return {body,send,advance,hide:()=>{hidden=true;}};
}
it('resolves custom geometry and motion only from host state and leaves input untouched',()=>{
  const base=[part('custom')], input=record([part('prop')]), before=structuredClone(input);
  const expanded=appendScene(input,base);
  expect(expanded.body.program.children[0].parts).toEqual([...base,...input.body.program.children[0].parts]);
  expect(input).toEqual(before);expect(expanded.body.program.children).toHaveLength(1);
  expect(()=>new LiveCompiler().compile(input,0)).toThrow('scene_append_unavailable');
  expect(new LiveCompiler().compile(input,0,base).program.kind).toBe('program');
});
it('rejects collisions, invalid programs, unsupported context and expanded budgets',()=>{
  const base=[part('custom')];expect(()=>appendScene(record([part('custom')]),base)).toThrow('scene_append_collision');
  expect(()=>appendScene(record([part('prop')]),[])).toThrow('scene_append_unavailable');
  const nested=record([part('prop')]);nested.body.program.children.push({type:'wait',durationMs:1});
  expect(()=>appendScene(nested,base)).toThrow('scene_append_program');
  expect(()=>appendScene(record([part('prop')]),Array.from({length:24},(_,i)=>part('p'+i)))).toThrow('scene_append_part_limit_remaining_0');
  expect(()=>appendScene(record(Array.from({length:8},(_,i)=>part('new'+i))),Array.from({length:18},(_,i)=>part('p'+i)))).toThrow('scene_append_part_limit_remaining_6');
  const track={group:'shared',pivot:[0,0,0],keyframes:[{atMs:0,translate:[0,0,0],rotate:[0,0,0]},{atMs:1000,translate:[1,0,0],rotate:[0,0,0]}]};
  const a={...part('a'),motion:undefined,trajectory:track} as Part, b={...a,id:'b'};
  expect(()=>appendScene(record([b]),[a])).toThrow('scene_append_track_collision');
  const oversized=record([part('prop')]);oversized.padding='x'.repeat(33000);
  expect(()=>appendScene(oversized,base)).toThrow('record_too_large');
});
it('admits atomically, rejects overlap and replay, then appends to the new executed scene',()=>{
  const f=setup();const first=record([part('prop')]);expect(f.send(first).status).toBe('accepted');
  expect(f.send(record([part('extra')],3)).status).toBe('rejected'); f.advance(200);
  expect(f.body.scheduler.sceneParts.map(p=>p.id)).toEqual(['custom','prop']);
  expect(f.send(first).status).toBe('rejected');expect(f.send(record([part('extra')],3)).status).toBe('accepted');f.advance(200);
  expect(f.body.scheduler.sceneParts.map(p=>p.id)).toEqual(['custom','extra','prop']); f.body.dispose();
});
it.each(['hidden','off','frozen','pending','epoch'])('rejects %s without replacing the existing scene',mode=>{
  const f=setup(); const before=structuredClone(f.body.scheduler.sceneParts);
  if(mode==='hidden')f.hide();if(mode==='off')f.body.controls.mode='off';
  if(mode==='frozen')f.body.scheduler.cancel(f.body.scheduler.epoch);
  if(mode==='pending')expect(f.send(record([part('replacement')],2,false)).status).toBe('accepted');
  const r=record([part('prop')],3);r.epoch=mode==='epoch'?'obsolete':f.body.scheduler.epoch;
  expect(f.body.admit(r).status).toBe('rejected');
  if(!['frozen','pending'].includes(mode))expect(f.body.scheduler.sceneParts).toEqual(before);
  if(mode==='pending'){f.advance(200);expect(f.body.scheduler.sceneParts.map(p=>p.id)).toEqual(['replacement']);}
  f.body.dispose();
});
it('Stop revokes an admitted append before execution and legacy replacement remains valid',()=>{
  const f=setup();expect(f.send(record([part('prop')])).status).toBe('accepted');
  f.body.scheduler.cancel('new-epoch',false);f.advance(200);
  expect(f.body.scheduler.sceneParts).toEqual([]);
  expect(f.send(record([part('whole')],1,false)).status).toBe('accepted');f.advance(200);
  expect(f.body.scheduler.sceneParts.map(p=>p.id)).toEqual(['whole']);f.body.dispose();
});
it('preserves existing finite control clocks, expiry and style/flow without installing append configuration',()=>{
  const f=setup(), old=record([part('custom')],2,false);
  old.body.configuration.poses=[{type:'pose',target:{part:'custom',prop:'rotateZ'},value:.2,durationMs:1000}];
  expect(f.send(old).status).toBe('accepted');f.advance(200);
  const installed=(f.body.controls as any).installedAt, held=(f.body as any).lifecycle.held;
  expect(installed).toBeGreaterThan(0);expect(held).toBeDefined();expect(held.until).toBeGreaterThan(performance.now());
  const style={color:f.body.scheduler.state.color,flow:f.body.scheduler.state.flow};
  const install=vi.spyOn(f.body.controls,'install');
  const pose=structuredClone(f.body.controls.sample(performance.now(),null,0));
  expect(pose.some(write=>write.target.part==='custom' && write.value>0 && (write.weight??0)>0)).toBe(true);
  expect(f.send(record([part('prop')],3)).status).toBe('accepted');
  expect(f.body.controls.sample(performance.now(),null,0)).toEqual(pose);f.advance(200);
  expect(install).not.toHaveBeenCalled();expect((f.body.controls as any).installedAt).toBe(installed);
  expect((f.body as any).lifecycle.held).toBe(held);
  expect({color:f.body.scheduler.state.color,flow:f.body.scheduler.state.flow}).toEqual(style);
  f.advance(700);expect((f.body as any).lifecycle.held).toBeUndefined();f.body.dispose();
});
it('rejects incoming append controls and observer ownership',()=>{
  const input=record([part('prop')]);input.body.configuration.poses=[{type:'pose',target:{part:'prop',prop:'x'},value:.1,durationMs:1000}];
  expect(()=>new LiveCompiler().compile(input,0,[part('custom')])).toThrow('scene_append_controls');
  const f=setup(), compiled=new LiveCompiler().compile(record([part('prop')]),0,[part('custom')]);
  expect(()=>f.body.admitReactive(compiled,{} as any)).toThrow('reactive_delegation_forbidden');f.body.dispose();
});
it.each(['collision','stale_seq','rate_limited'])('rejects %s before changing intent, controls or leases',reason=>{
  const f=setup(), prepare=vi.spyOn(f.body,'prepareUserMutation'), install=vi.spyOn(f.body.controls,'install');
  if(reason==='rate_limited')(f.body.scheduler as any).admissions=Array(10).fill(performance.now());
  const input=record([part(reason==='collision'?'custom':'prop')],reason==='stale_seq'?0:2);
  const before=structuredClone(f.body.scheduler.sceneParts), lease=(f.body as any).userLeaseUntil;
  expect(f.send(input).status).toBe('rejected');expect(prepare).not.toHaveBeenCalled();expect(install).not.toHaveBeenCalled();
  expect((f.body as any).userLeaseUntil).toBe(lease);expect(f.body.scheduler.sceneParts).toEqual(before);f.body.dispose();
});
it.each([{transient:true},{observerHandoffMs:1000}])('does not grant observer ownership over an inherited protected body: %j',grant=>{
  const f=setup();const input=record([part('prop')]);Object.assign(input.body.configuration,grant);
  expect(f.send(input)).toMatchObject({status:'rejected',code:'scene_append_ownership'});
  f.advance(2000);expect(f.body.canReactive()).toBe(false);expect(f.body.userSceneOwned).toBe(true);
  expect(f.body.scheduler.sceneParts.map(p=>p.id)).toEqual(['custom']);f.body.dispose();
});

it('returns authoritative remaining capacity through host rejection without losing the scene',()=>{
  const f=setup();expect(f.send(record(Array.from({length:18},(_,i)=>part('p'+i)),2,false)).status).toBe('accepted');f.advance(200);
  expect(f.send(record(Array.from({length:8},(_,i)=>part('new'+i)),3))).toMatchObject({status:'rejected',code:'scene_append_part_limit_remaining_6'});
  expect(f.body.scheduler.sceneParts).toHaveLength(18);f.body.dispose();
});
