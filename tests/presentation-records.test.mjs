import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createPresentationRecordStream, parsePresentationRecord } from '../integrations/presentation-records.mjs';

const retain = '{"mode":"retain","payload":null}';
const make = options => createPresentationRecordStream({ isCurrent: () => true, ...options });
const scene = { mode: 'compose', payload: { base: 'none', parts: [{ id: 'dot', kind: 'ellipsoid', center: [0,0,0], scale: [0.2,0.2,0.2] }] } };

test('emits only a complete record across arbitrary one-character deltas', () => {
  const parser = make(); let out = [];
  for (let i = 0; i < retain.length; i++) {
    out = parser.push(retain[i]); assert.equal(out.length, i === retain.length - 1 ? 1 : 0);
  }
  assert.deepEqual(out, [{ mode: 'retain', payload: null }]); assert.deepEqual(parser.finish(), []);
});
test('compact optional geometry validates without required nullable verbosity', () => {
  assert.deepEqual(parsePresentationRecord(JSON.stringify(scene)), scene);
});
test('braces in strings and escaped quotes cannot prematurely end record', () => {
  const invalid = '{"mode":"retain","payload":"}\\\"{noise"}';
  const parser = make(); assert.deepEqual(parser.push(invalid.slice(0,-1)), []);
  assert.throws(() => parser.push('}'), /invalid/);
});
test('source append can remain current but corrections and cancel revoke before emission', () => {
  let current = true; const parser = make({ isCurrent: () => current });
  assert.deepEqual(parser.push(retain.slice(0,-1)), []);
  current = false; assert.throws(() => parser.push('}'), /stale/);
  assert.throws(() => parser.push('}'), /closed/);
});
test('source callback exception fails closed', () => {
  assert.throws(() => make({ isCurrent() { throw Error('source'); } }).push(retain), /stale/);
});
test('rejects host authority and arbitrary text from author', () => {
  for (const key of ['requestId','expectedEpoch','expectedSceneRevision','observerContext','observerHandoffMs','transient']) {
    assert.throws(() => parsePresentationRecord(JSON.stringify({ ...scene, payload: { ...scene.payload, [key]: 1 } })), /schema/);
  }
  for (const text of ['```json\n'+retain, 'hello', '[]']) assert.throws(() => make().push(text), /framing/);
});
test('bounds total bytes and nesting before parse', () => {
  assert.throws(() => make({ maxBytes: 8 }).push(retain), /size/);
  assert.throws(() => make({ maxDepth: 2 }).push('{"x":[['), /depth/);
});
test('cannot emit incomplete, malformed or invalid geometry', () => {
  const parser = make(); parser.push(retain.slice(0,-1)); assert.throws(() => parser.finish(), /incomplete/);
  for (const text of ['{"mode":}', JSON.stringify({ ...scene, payload: { parts: [] } }), '{"mode":"other","payload":null}'])
    assert.throws(() => make().push(text), /invalid/);
});
test('only one scene per checkpoint, trailing whitespace allowed, duplicate rejected', () => {
  const parser = make(); assert.equal(parser.push(retain+'\n').length, 1);
  assert.deepEqual(parser.push('  \r\n'), []); assert.throws(() => parser.push(retain), /extra/);
  assert.throws(() => make().push(retain+retain), /extra/);
});
test('cancel and finish are terminal', () => {
  const a = make(); a.cancel(); assert.throws(() => a.push(retain), /closed/);
  const b = make(); b.push(retain); b.finish(); assert.throws(() => b.push(''), /closed/);
});
test('compiler rejects impossible track semantics after shape schema validation', () => {
  assert.throws(() => parsePresentationRecord(JSON.stringify({ ...scene, payload: { ...scene.payload, removePartIds: ['missing'] } })));
});



test('reports bounded parser cause without source or arbitrary error text and still fails closed',()=>{
 const reports=[];
 const p=make({parseRecord(){throw Error('diagram_quote');},onRejectedRecord:v=>reports.push(v)});
 assert.throws(()=>p.push(retain),/presentation_record_invalid/);assert.deepEqual(reports,[{code:'presentation_record_invalid',cause:'diagram_quote'}]);
 const q=make({parseRecord(){throw Error('private source text must not leak');},onRejectedRecord:v=>reports.push(v)});
 assert.throws(()=>q.push(retain),/presentation_record_invalid/);assert.equal(reports[1].cause,'unclassified');
 assert.throws(()=>make({parseRecord(){throw Error('diagram_budget');},onRejectedRecord(){throw Error('telemetry failure');}}).push(retain),/presentation_record_invalid/);
});
