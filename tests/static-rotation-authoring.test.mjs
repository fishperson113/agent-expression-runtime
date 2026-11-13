import { expect, it } from 'vitest';
import Ajv from 'ajv';
import { composeExpression, compositionSchema } from '../integrations/compose-expression.mjs';
import { readFileSync } from 'node:fs';
import { LiveCompiler } from '../src/core/live/compiler.ts';
import { Compiler } from '../src/core/compiler/compiler.ts';
import { rotatePoint } from '../src/core/geometry/sampling.ts';
const part = rotation => ({id:'shape',kind:'ellipsoid',center:[0,0,0],scale:[.2,.3,.1],rotation});
const output = input => composeExpression(input).body.children[0].parts;
const compile = parts => new Compiler().compile({v:1,epoch:'test',seq:1,kind:'program',track:'body',policy:'replace',body:{type:'assemble',parts,durationMs:100}},0);
const failed=[4.084070449666731,5.340707511102648,6.5973445725385655];
const corrected=[-2.1991148575128556,-.9424777960769383,.3141592653589791];
it('replays observed static angles with equivalent orientation and strict compiled output',()=>{
  const input={parts:failed.map((angle,i)=>({...part([0,0,angle]),id:'petal'+i}))}, copy=structuredClone(input);
  const parts=output(input);expect(input).toEqual(copy);expect(output(input)).toEqual(parts);
  parts.forEach((p,i)=>{expect(p.rotation[2]).toBeCloseTo(corrected[i],12);
    for(const vector of [[1,0,0],[0,1,0],[0,0,1]]) rotatePoint(vector,input.parts[i].rotation).forEach((v,k)=>expect(rotatePoint(vector,p.rotation)[k]).toBeCloseTo(v,12));});
  expect(compile(parts).kind).toBe('program');expect(output({parts})).toEqual(parts);
});
it('handles all three static axes, signed wraps and two-turn boundaries deterministically',()=>{
  for(const rotation of [[4*Math.PI,-4*Math.PI,2*Math.PI],[3*Math.PI,-3*Math.PI,3.8*Math.PI],[-6.59,5.34,4.08]]){
    const normalized=output({parts:[part(rotation)]})[0].rotation;
    for(const vector of [[.2,.7,-.4],[1,0,0],[0,0,1]]) rotatePoint(vector,rotation).forEach((v,k)=>expect(rotatePoint(vector,normalized)[k]).toBeCloseTo(v,12));
    expect(normalized.every(v=>Math.abs(v)<=Math.PI)).toBe(true);expect(output({parts:[part(normalized)]})[0].rotation).toEqual(normalized);
  }
});
it('preserves already-schema-valid static values exactly including exact legacy boundary and signed zero',()=>{
  const input={parts:[part([-0,Math.PI,-Math.PI])]}, result=output(input)[0].rotation;
  expect(Object.is(result[0],-0)).toBe(true);expect(result).toEqual(input.parts[0].rotation);
  expect(output({parts:[part([-.7,0,-Math.PI])]})[0].rotation).toEqual([-.7,0,-Math.PI]);
});
it.each([Infinity,-Infinity,NaN,4*Math.PI+1e-9,-4*Math.PI-1e-9,90,'6.5',null])('rejects invalid/out-of-authoring-range static angle %s',angle=>{
  expect(()=>output({parts:[part([0,0,angle])]})).toThrow('composition_arguments');
});
it('keeps motion and trajectory bounds/data unchanged and raw AST static bounds strict',()=>{
  const motion={pivot:[0,0,0],translate:[.1,0,0],rotate:[0,0,.2],periodMs:2000,phase:0};
  const valid={...part([0,0,4.08]),motion};expect(output({parts:[valid]})[0].motion).toEqual(motion);
  expect(()=>output({parts:[{...valid,motion:{...motion,rotate:[0,0,4.08]}}]})).toThrow('composition_arguments');
  const track={group:'g',pivot:[0,0,0],keyframes:[{atMs:0,translate:[0,0,0],rotate:[0,0,0]},{atMs:1000,translate:[1,0,0],rotate:[0,0,2]}]};
  const input={parts:[{...part([0,0,4.08]),trackRef:'g'}],tracks:[track]};
  expect(output(input)[0].trajectory).toEqual(track);
  const invalid=structuredClone(input);invalid.tracks[0].keyframes[1].rotate[2]=4.08;
  expect(()=>output(invalid)).toThrow('composition_arguments');
  expect(()=>output({parts:[{...part([0,0,0]),trajectory:invalid.tracks[0]}]})).toThrow('composition_arguments');
  expect(()=>compile([part([0,0,4.08])])).toThrow();
});
it('keeps schema truthful/bounded and reports the real malformed field not valid wide rotation',()=>{
  expect(JSON.stringify(compositionSchema).length).toBeLessThanOrEqual(5000);
  const validate=new Ajv({strict:false,strictNumbers:true}).compile(compositionSchema);
  expect(validate({parts:[part([0,0,6.59])]})).toBe(true);
  try{output({parts:[{...part([0,0,6.59]),scale:[.2,.3,.001]}]});throw Error('should reject');}
  catch(error){expect(error.message).toBe('composition_arguments');expect(error.details.some(d=>d.path==='/parts/0/scale/2')).toBe(true);expect(error.details.some(d=>d.path.includes('rotation'))).toBe(false);}
});

const fixtures=JSON.parse(readFileSync(new URL('./fixtures/flower-static-rotation.json',import.meta.url),'utf8'));
it.each(['old8','new7'])('replays exact recorded %s payloads without altering geometry except equivalent angles',name=>{
  const {rejected,corrected}=fixtures[name], source=structuredClone(rejected);
  const normalized=composeExpression(rejected), expected=composeExpression(corrected);
  const actualParts=normalized.body.program.children[0].parts, expectedParts=expected.body.program.children[0].parts;
  actualParts.forEach((p,i)=>{
    if(p.rotation)p.rotation.forEach((angle,k)=>expect(angle).toBeCloseTo(expectedParts[i].rotation[k],12));
    const {rotation:_a,...rest}=p,{rotation:_b,...expectedRest}=expectedParts[i];expect(rest).toEqual(expectedRest);
  });
  expect(rejected).toEqual(source);expect(composeExpression(rejected)).toEqual(normalized);
  const base=Array.from({length:name==='new7'?17:18},(_,i)=>({...part([0,0,0]),id:'existing'+i}));
  const envelope={v:1,epoch:'test',seq:1,kind:'program',track:'body',policy:'replace',body:normalized.body};
  if(name==='new7')expect(new LiveCompiler().compile(envelope,0,base).program.kind).toBe('program');
  else expect(()=>new LiveCompiler().compile(envelope,0,base)).toThrow('scene_append_part_limit_remaining_6');
});
