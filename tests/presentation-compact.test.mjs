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
