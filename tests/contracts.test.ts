import { it, expect } from 'vitest';
import Ajv from 'ajv';
import schema from '../src/contracts/protocol.schema.json';
import assembly from '../src/contracts/assembly.schema.json';
import { Compiler } from '../src/core/compiler/compiler';
import { capability } from '../src/primitives/registry';
const validate = new Ajv({ strict: false }).compile(schema);
it('keeps wire geometry definitions and published budgets synchronized', () => {
  const { $schema, $defs, title, ...node } = assembly;
  expect(schema.$defs.assembly).toEqual(node);
  expect(schema.$defs.assemblyPart).toEqual($defs.assemblyPart);
  expect(node.properties.parts.maxItems).toBe(capability.assembly.parts);
  expect($defs.assemblyPart.anyOf.map(p => p.properties.kind.const)).toEqual(capability.assembly.kinds);
});
it('published protocol schema agrees with compiler for valid and invalid wire fixtures', () => {
  const base = { v: 1, epoch: 'e', seq: 1, kind: 'program', track: 'body', policy: 'replace' };
  const fixtures = [
    ...capability.shapes.map((target) => ({
      ...base,
      body: { type: 'morph', target, durationMs: 100 },
    })),
    ...capability.fields.map((field) => ({
      ...base,
      body: { type: 'flow', field, strength: 0.5, durationMs: 10 },
    })),
    { ...base, body: { type: 'assemble', parts: [
      { id: 'eye', kind: 'ellipsoid', center: [0, 0.5, 0], scale: [0.1, 0.1, 0.1] },
      { id: 'mouth', kind: 'curve', points: [[-0.5, 0, 0], [0, -0.5, 0], [0.5, 0, 0]], radius: 0.02 },
    ], durationMs: 900 } },
    { ...base, body: { type: 'assemble', parts: [{ id: 'bad', kind: 'curve', points: [[0, 0, 0]], radius: 1 }], durationMs: 900 } },
    { v: 1, epoch: 'e', seq: 1, kind: 'state', body: { brightness: 0.2 } },
    { v: 1, epoch: 'e', seq: 1, kind: 'state', body: { rise: -1, advance: 1, spread: 0.25, grow: 2 } },
    { v: 1, epoch: 'e', seq: 1, kind: 'state', body: { grow: 3 } },
    ...[
      { type: 'style', color: '#abcdef', durationMs: 0 },
      { type: 'wait', durationMs: 10 },
      { type: 'parallel', children: [{ type: 'wait', durationMs: 20 }] },
      { type: 'morph', target: 'face', durationMs: 1 },
      { type: 'style', durationMs: 10 },
      { type: 'flow', field: 'orbit', strength: 2, durationMs: 10 },
      { type: 'wait', durationMs: 0, extra: 1 },
      { type: 'eval', code: 'x' },
    ].map((body) => ({ ...base, body })),
    { ...base, v: 2, body: { type: 'wait', durationMs: 1 } },
    { ...base, unknown: 1, body: { type: 'wait', durationMs: 1 } },
  ];
  for (const fixture of fixtures) {
    let compiled = true;
    try {
      new Compiler().compile(fixture, 0);
    } catch {
      compiled = false;
    }
    expect(compiled, JSON.stringify(fixture)).toBe(validate(fixture));
  }
});
it('publishes parameterized geometry macros that the compiler can instantiate', () => {
  const record = { v: 1, epoch: 'e', seq: 1, kind: 'define', body: {
    name: 'orb', revision: 1, params: { size: 'number', x: 'number' }, body: { type: 'assemble', durationMs: 500,
      parts: [{ id: 'orb', kind: 'ellipsoid', center: [{ type: 'param', name: 'x' }, 0, 0],
        scale: [{ type: 'param', name: 'size' }, 0.2, 0.2] }] },
  } };
  expect(validate(record)).toBe(true);
  const compiler = new Compiler(); compiler.compile(record, 0);
  expect(compiler.compile({ v: 1, epoch: 'e', seq: 2, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'call', name: 'orb', revision: 1, args: { size: 0.5, x: 0.3 } } }, 0).kind).toBe('program');
});

it('publishes rigid group trajectories usable by direct and macro assemblies', () => {
  const trajectory = { group: 'actor', pivot: [0, 0, 0], keyframes: [
    { atMs: 0, translate: [0, 0, 0], rotate: [0, 0, 0] },
    { atMs: 1000, translate: [1, 0, 0], rotate: [0, 0, 0.5], easing: 'smoothstep' },
  ] };
  const body = { type: 'assemble', durationMs: 300, parts: [{ id: 'actor', kind: 'ellipsoid',
    center: [0, 0, 0], scale: [0.2, 0.2, 0.2], trajectory }] };
  const compiler = new Compiler();
  const direct = { v: 1, epoch: 'e', seq: 1, kind: 'program', track: 'body', policy: 'replace', body };
  expect(validate(direct)).toBe(true); expect(compiler.compile(direct, 0).kind).toBe('program');
  const macro = { v: 1, epoch: 'e', seq: 2, kind: 'define', body: { name: 'moving', revision: 1, params: {}, body } };
  expect(validate(macro)).toBe(true); expect(compiler.compile(macro, 0).kind).toBe('define');
});
