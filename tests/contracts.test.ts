import { it, expect } from 'vitest';
import Ajv from 'ajv';
import schema from '../src/contracts/protocol.schema.json';
import { Compiler } from '../src/core/compiler/compiler';
import { capability } from '../src/primitives/registry';
const validate = new Ajv({ strict: false }).compile(schema);
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
