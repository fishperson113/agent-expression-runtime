import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseCompactPresentationRecord as parse } from '../integrations/presentation-compact.mjs';
import { createPresentationRecordStream } from '../integrations/presentation-records.mjs';

const sample = { base: 'replace', parts: [['e','a',0,0,0,0.2,0.3,0.1,'#aabbcc'],['c','b',[[0,0,0],[1,0,0]],0.02]] };
const read = value => parse(JSON.stringify(value));
test('expands generic ellipsoid/curve into existing compiler validated DSL', () => {
  const result = read(sample);
  assert.equal(result.mode, 'compose'); assert.equal(result.payload.base, 'none');
  assert.deepEqual(result.payload.parts[0], { id:'a',kind:'ellipsoid',center:[0,0,0],scale:[0.2,0.3,0.1],color:'#aabbcc' });
  assert.equal(result.payload.parts[1].kind, 'curve');
});
test('keep preserves current scene and retain cannot smuggle changes', () => {
  assert.equal(read({ ...sample, base:'keep' }).payload.base, 'current_scene');
  assert.deepEqual(read({base:'retain'}), {mode:'retain',payload:null});
  assert.throws(() => read({...sample,base:'retain'}));
  assert.throws(() => read({base:'retain',annotations:{labels:[]}}));
});
test('complete record streaming carries annotations atomically', () => {
  const annotations = {labels:[{text:'Nguồn A',x:0.2,y:0.3}], arrows:[{from:[0.2,0.3],to:[0.8,0.3]}]};
  const text=JSON.stringify({...sample,annotations});
  const stream=createPresentationRecordStream({isCurrent:()=>true,parseRecord:parse});
  assert.deepEqual(stream.push(text.slice(0,-1)),[]);
  assert.deepEqual(stream.push('}')[0].annotations,annotations); stream.finish();
});
test('annotation bounds, count, fields and text controls fail closed', () => {
  for (const annotations of [
    {labels:[{text:'a',x:1.1,y:0}]}, {labels:[{text:'a'.repeat(81),x:0,y:0}]},
    {labels:[{text:'a\nb',x:0,y:0}]}, {labels:Array(9).fill({text:'a',x:0,y:0})},
    {labels:[{text:'a',x:0,y:0,html:true}]}, {arrows:[{from:[0,0],to:[0,0]}]},
    {arrows:[{from:[0,0],to:[2,0]}]}, {style:'override'}, {labels:[{text:'a'.repeat(49),x:0,y:0}]},
    {labels:Array(6).fill({text:'a'.repeat(48),x:0,y:0})}, {labels:[{text:'a\u202eb',x:0,y:0}]},
  ]) assert.throws(()=>read({...sample,annotations}));
});
test('part counts, tuple tails, unknown primitives and duplicate IDs reject', () => {
  for (const parts of [[], Array(25).fill(sample.parts[0]), [sample.parts[0],sample.parts[0]],
    [['e','a',0,0,0,1,1,1,'#ffffff','extra']], [['preset','queue']], [['c','a',[[0,0,0]],0.1]]])
    assert.throws(()=>read({...sample,parts}));
});
test('rejects host authority, malformed colors and invalid numeric geometry', () => {
  assert.throws(()=>read({...sample,expectedEpoch:'evil'}));
  assert.throws(()=>read({...sample,parts:[['e','a',0,0,0,-1,1,1]]}));
  assert.throws(()=>read({...sample,parts:[['e','a',0,0,0,1,1,1,'red']]}));
  assert.throws(()=>read({...sample,durationMs:999999}));
});
test('HTML-looking label stays plain data, never executable markup', () => {
  const value=read({...sample,annotations:{labels:[{text:'<b>A</b>',x:0,y:0}]}});
  assert.equal(value.annotations.labels[0].text,'<b>A</b>');
});
test('compact representation is smaller for the same generic geometry', () => {
  assert.ok(JSON.stringify(sample).length < JSON.stringify(read(sample)).length);
});



test('compact advertised numeric and ID limits match the underlying DSL', async () => {
  const { compactPresentationSchema: compact } = await import('../integrations/presentation-compact.mjs');
  const { compositionSchema: source } = await import('../integrations/compose-expression.mjs');
  const [e,c] = compact.properties.parts.items.oneOf;
  const curve = source.$defs.part.anyOf.find(part=>part.properties.kind.const==='curve').properties;
  const ellipsoid = source.$defs.part.anyOf.find(part=>part.properties.kind.const==='ellipsoid').properties;
  assert.deepEqual(e.items[1],source.$defs.id);
  assert.deepEqual(e.items[2],source.$defs.position.items);
  assert.deepEqual(e.items[5],ellipsoid.scale.items);
  assert.deepEqual(c.items[3],curve.radius);
  assert.deepEqual(compact.properties.durationMs,source.properties.durationMs);
  assert.equal(compact.properties.parts.maxItems,source.properties.parts.maxItems);
  for (const part of [['e','a',0,0,0,1.7,1,1],['e','a',2.1,0,0,1,1,1],
    ['e','a',0,0,0,0.019,1,1],['c','a',[[0,0,0],[1,0,0]],0.251],
    ['e','a'.repeat(33),0,0,0,1,1,1]])
    assert.throws(()=>read({base:'replace',parts:[part]}),/compact_record_schema/);
  assert.equal(read({base:'replace',parts:[['e','a',-2,2,0,0.02,1.5,1],
    ['c','b',[[0,0,0],[1,0,0]],0]]}).mode,'compose');
});

test('optional annotation arrays expand to canonical browser shape', () => {
  const labels=[{text:'A',x:0.2,y:0.3}];
  const arrows=[{from:[0.2,0.3],to:[0.8,0.3]}];
  assert.deepEqual(read({...sample,annotations:{labels}}).annotations,{labels,arrows:[]});
  assert.deepEqual(read({...sample,annotations:{arrows}}).annotations,{labels:[],arrows});
  assert.deepEqual(read({...sample,annotations:{}}).annotations,{labels:[],arrows:[]});
  assert.equal(read(sample).annotations,undefined);
});

const motionTuple = [['a','b'], [0,0,0], [0,0.1,0], [0,0,0.1], 2400, 0];
test('optional shared authored motion expands atomically without changing static geometry', () => {
  const staticResult = read(sample), result = read({...sample,motions:[motionTuple],style:{pointSize:3,brightness:0.85}});
  for (const [index,part] of result.payload.parts.entries()) {
    const {motion,...geometry}=part;
    assert.deepEqual(geometry,staticResult.payload.parts[index]);
    assert.deepEqual(motion,{pivot:[0,0,0],translate:[0,0.1,0],rotate:[0,0,0.1],periodMs:2400,phase:0});
  }
  assert.notEqual(result.payload.parts[0].motion,result.payload.parts[1].motion);
  assert.deepEqual(result.payload.style,{pointSize:3,brightness:0.85});
  const stream=createPresentationRecordStream({isCurrent:()=>true,parseRecord:parse});
  const text=JSON.stringify({...sample,motions:[motionTuple]});
  assert.deepEqual(stream.push(text.slice(0,-1)),[]);
  assert.equal(stream.push('}')[0].payload.parts[1].motion.periodMs,2400);
});
test('motion cannot target retained, duplicate or missing parts or extend ownership', () => {
  for (const motions of [[], [[['missing'],...motionTuple.slice(1)]],
    [[['a','a'],...motionTuple.slice(1)]], [motionTuple,motionTuple],
    [[...motionTuple,'extra']], [{parts:['a'],script:'unsafe'}]]) {
    assert.throws(()=>read({...sample,base:'keep',motions}));
  }
  assert.throws(()=>read({base:'retain',motions:[motionTuple]}));
  assert.throws(()=>read({...sample,motions:[motionTuple],lifetimeMs:99999}));
});
test('compact motion inherits exact canonical bounds and rejects malformed numbers', () => {
  for (const [index,value] of [[1,[2.1,0,0]],[2,[0.401,0,0]],[3,[0.601,0,0]],
    [4,999],[4,10001],[5,-0.1],[5,7],[2,[0,0]],[4,null]]) {
    const motion=structuredClone(motionTuple);motion[index]=value;
    assert.throws(()=>read({...sample,motions:[motion]}));
  }
  for(const style of [{pointSize:9},{brightness:1.1},{color:'red'},{persist:true},{}])
    assert.throws(()=>read({...sample,style}));
  const result=read({...sample,motions:[[['a'],[-2,2,0],[-0.4,0.4,0],[-0.6,0.6,0],10000,2*Math.PI]]});
  assert.equal(result.payload.parts[0].motion.periodMs,10000);
  assert.equal(result.payload.parts[1].motion,undefined);
});

test('expanded shared motion follows canonical rigid transforms over time', async () => {
  const {sculptureCloud,motionTransforms}=await import('../src/core/geometry/sampling.ts');
  const result=read({...sample,motions:[motionTuple]});
  const cloud=sculptureCloud({parts:result.payload.parts},100);
  const start=motionTransforms(cloud,0), quarter=motionTransforms(cloud,600);
  assert.deepEqual(quarter[0],quarter[1]);
  assert.notDeepEqual(start[0],quarter[0]);
  assert.ok([...quarter[0]].every(Number.isFinite));
});

test('advertised base alternatives reject observed missing-parts outputs before semantic parsing',async()=>{
 const {default:Ajv}=await import('ajv');const {compactPresentationSchema}=await import('../integrations/presentation-compact.mjs');
 const {miniPresentationSchema,parseMiniPresentation}=await import('../integrations/presentation-provider.mjs');
 for(const [schema,decode] of [[compactPresentationSchema,read],[miniPresentationSchema,value=>parseMiniPresentation(JSON.stringify(value))]]){
  const validate=new Ajv({strict:false,strictNumbers:true}).compile(schema);
  for(const value of [{base:'keep'},{base:'replace'},{base:'keep',durationMs:600},{base:'keep',durationMs:500,style:{brightness:.55}},{base:'retain',parts:sample.parts},{base:'retain',durationMs:500},{base:'replace',parts:[]},{base:'keep',parts:null},{base:'replace',parts:null},...Object.entries({style:{brightness:.55},motions:[motionTuple],annotations:{labels:[]}}).map(([key,value])=>({base:'retain',[key]:value}))]){
   assert.equal(validate(value),false,JSON.stringify(value));assert.throws(()=>decode(value));
  }
  for(const value of [{base:'retain'},sample,{...sample,base:'keep'},{...sample,style:{brightness:.55}},{...sample,motions:[motionTuple]}]){assert.equal(validate(value),true,JSON.stringify(validate.errors));assert.doesNotThrow(()=>decode(value));}
 }
});
