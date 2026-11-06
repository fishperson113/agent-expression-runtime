import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { JsonLines } from '../src/adapters/framing';
import { Scheduler, initialState } from '../src/core/runtime/scheduler';
import type { BodyState } from '../src/core/ports';
import type { ProgramIR } from '../src/core/runtime/ir';
const morph = (target = 'wall', durationMs = 1000) => ({
  type: 'morph',
  target,
  durationMs,
  easing: 'linear',
});
const program = (body: unknown, seq = 1, extra = {}) => ({
  v: 1,
  epoch: 'e',
  seq,
  kind: 'program',
  track: 'body',
  policy: 'replace',
  body,
  ...extra,
});
const rig = () => {
  let now = 0;
  let state = initialState();
  const codes: string[] = [];
  const c = new Compiler(),
    s = new Scheduler(
      { now: () => now },
      { apply: (v: BodyState) => (state = v), dispose() {} },
      { count: (code) => codes.push(code) },
    );
  s.cancel('e');
  return {
    c,
    s,
    codes,
    get state() {
      return state;
    },
    time: (v: number) => {
      now = v;
      s.tick();
    },
  };
};
describe('framing', () => {
  it('handles every UTF-8 byte split and multiple records', () => {
    const value = { text: 'Xin chào 🌐' },
      bytes = new TextEncoder().encode(JSON.stringify(value) + '\n' + JSON.stringify(value) + '\n');
    for (let i = 0; i <= bytes.length; i++) {
      const records: unknown[] = [],
        errors: string[] = [];
      const f = new JsonLines(
        (v) => records.push(v),
        (c) => errors.push(c),
      );
      f.push(bytes.slice(0, i));
      f.push(bytes.slice(i));
      f.end();
      expect(records).toEqual([value, value]);
      expect(errors).toEqual([]);
    }
  });
  it('drops oversized input through delimiter and discards partial EOF', () => {
    const records: unknown[] = [],
      errors: string[] = [];
    const f = new JsonLines(
      (v) => records.push(v),
      (e) => errors.push(e),
      10,
    );
    f.push(new TextEncoder().encode('x'.repeat(100) + '\n{}\n{"x":'));
    f.end();
    expect(records).toEqual([{}]);
    expect(errors).toEqual(['record_too_large', 'incomplete_eof']);
  });
  it('rejects malformed UTF-8 without affecting next record', () => {
    const values: unknown[] = [],
      errors: string[] = [];
    const f = new JsonLines(
      (v) => values.push(v),
      (e) => errors.push(e),
    );
    f.push(new Uint8Array([34, 255, 34, 10, 123, 125, 10]));
    expect(values).toEqual([{}]);
    expect(errors).toEqual(['invalid_json']);
  });
});
describe('compiler', () => {
  it('allows ordered instantaneous writes inside a parallel branch', () => {
    expect(() =>
      new Compiler().compile(
        program({
          type: 'parallel',
          children: [
            { type: 'sequence', children: [morph('wall', 0), morph('wave', 0)] },
            { type: 'flow', field: 'orbit', strength: 0.2, durationMs: 100 },
          ],
        }),
        0,
      ),
    ).not.toThrow();
  });
  it('validates typed string template parameters in constrained fields', () => {
    const c = new Compiler();
    c.compile(
      {
        v: 1,
        epoch: 'e',
        seq: 1,
        kind: 'define',
        body: {
          name: 'tint',
          revision: 1,
          params: { color: 'string' },
          body: { type: 'style', color: { type: 'param', name: 'color' }, durationMs: 200 },
        },
      },
      0,
    );
    expect(
      (
        c.compile(
          program({ type: 'call', name: 'tint', revision: 1, args: { color: '#abcdef' } }, 2),
          0,
        ) as ProgramIR
      ).ops[0].value,
    ).toBe('#abcdef');
    expect(() =>
      c.compile(program({ type: 'call', name: 'tint', revision: 1, args: { color: 'bad' } }, 3), 0),
    ).toThrow('color');
  });
  it.each([
    morph('invalid'),
    { type: 'eval', code: 'alert(1)' },
    { ...morph(), unknown: true },
    { ...morph(), durationMs: -1 },
    { ...morph(), durationMs: Infinity },
    { type: 'style', brightness: 2, durationMs: 2 },
  ])('rejects invalid records atomically: %j', (body) => {
    expect(() => new Compiler().compile(program(body), 0)).toThrow();
  });
  it('rejects unknown envelope fields and versions', () => {
    const c = new Compiler();
    expect(() => c.compile({ ...program(morph()), v: 2 }, 0)).toThrow();
    expect(() => c.compile({ ...program(morph()), extra: 1 }, 0)).toThrow();
  });
  it('lowers sequence/parallel/wait and rejects overlapping ownership', () => {
    const c = new Compiler();
    const ir = c.compile(
      program({
        type: 'sequence',
        children: [
          { type: 'wait', durationMs: 100 },
          {
            type: 'parallel',
            children: [morph(), { type: 'flow', field: 'orbit', strength: 0.3, durationMs: 2000 }],
          },
        ],
      }),
      0,
    ) as ProgramIR;
    expect(ir.duration).toBe(2100);
    expect(ir.ops.map((o) => o.at)).toEqual([100, 100]);
    expect(() =>
      c.compile(program({ type: 'parallel', children: [morph(), morph('wave')] }), 0),
    ).toThrow('property_conflict');
  });
  it('expands typed immutable macro revisions equivalently', () => {
    const c = new Compiler();
    const definition = {
      v: 1,
      epoch: 'e',
      seq: 1,
      kind: 'define',
      body: {
        name: 'shape',
        revision: 1,
        params: { ms: 'number' },
        body: {
          type: 'morph',
          target: 'wall',
          durationMs: { type: 'param', name: 'ms' },
          easing: 'linear',
        },
      },
    };
    c.compile(definition, 0);
    const ir = c.compile(
      program({ type: 'call', name: 'shape', revision: 1, args: { ms: 1000 } }, 2),
      0,
    ) as ProgramIR;
    expect(ir.ops).toEqual((c.compile(program(morph()), 0) as ProgramIR).ops);
    expect(() => c.compile(definition, 0)).toThrow('immutable_revision');
    expect(() =>
      c.compile(program({ type: 'call', name: 'shape', revision: 1, args: { ms: 'x' } }), 0),
    ).toThrow('parameter_type');
    expect(() => c.compile(program({ type: 'call', name: 'shape', args: { ms: 1 } }), 0)).toThrow();
  });
  it('rejects recursive macro before committing it', () => {
    const c = new Compiler();
    expect(() =>
      c.compile(
        {
          v: 1,
          epoch: 'e',
          seq: 1,
          kind: 'define',
          body: {
            name: 'loop',
            revision: 1,
            params: {},
            body: { type: 'call', name: 'loop', revision: 1, args: {} },
          },
        },
        0,
      ),
    ).toThrow('macro_cycle');
    expect(c.sizes.macros).toBe(0);
  });
  it('bounds depth and program duration', () => {
    const c = new Compiler();
    let body: any = morph();
    for (let i = 0; i < 18; i++) body = { type: 'sequence', children: [body] };
    expect(() => c.compile(program(body), 0)).toThrow('depth_budget');
    expect(() =>
      c.compile(
        program({ type: 'sequence', children: [morph('wall', 6000), morph('wave', 6000)] }),
        0,
      ),
    ).toThrow('duration_budget');
  });
});
describe('scheduler', () => {
  it('interpolates and replaces from actual displayed shape weights', () => {
    const r = rig();
    r.s.admit(r.c.compile(program(morph()), 0));
    r.time(500);
    expect(r.state.shapeWeights).toEqual([0.5, 0.5, 0, 0, 0, 0, 0]);
    r.s.admit(r.c.compile(program(morph('wave'), 2), 500));
    r.time(500);
    expect(r.state.shapeWeights).toEqual([0.5, 0.5, 0, 0, 0, 0, 0]);
    r.time(1000);
    expect(r.state.shapeWeights).toEqual([0.25, 0.25, 0.5, 0, 0, 0, 0]);
  });
  it('rejects stale epoch/seq and expired records, including late compiler results', () => {
    const r = rig();
    const ir = r.c.compile(program(morph()), 0);
    r.s.admit(ir);
    expect(r.s.admit(ir)).toBe('stale_seq');
    r.s.cancel('new');
    expect(r.s.admit(ir)).toBe('stale_epoch');
    r.s.cancel('e');
    r.time(3000);
    expect(r.s.admit(ir)).toBe('expired');
  });
  it('merges baseline patches and releases ownership over 250ms', () => {
    const r = rig();
    r.s.admit(
      r.c.compile(
        { v: 1, epoch: 'e', seq: 1, kind: 'state', body: { brightness: 0.2, durationMs: 0 } },
        0,
      ),
    );
    r.s.admit(
      r.c.compile(
        { v: 1, epoch: 'e', seq: 2, kind: 'state', body: { dispersion: 0.8, durationMs: 0 } },
        0,
      ),
    );
    r.time(0);
    expect(r.state.brightness).toBeCloseTo(0.2);
    expect(r.state.dispersion).toBeCloseTo(0.8);
    r.s.admit(r.c.compile(program({ type: 'style', brightness: 1, durationMs: 100 }, 3), 0));
    r.time(50);
    r.time(100);
    r.time(350);
    expect(r.state.brightness).toBeCloseTo(0.2);
  });
  it('bounds append queue and cancel bypasses it', () => {
    const r = rig();
    for (let i = 1; i <= 9; i++)
      expect(
        r.s.admit(
          r.c.compile(program(morph('wall', 10000), i, { policy: 'append', ttlMs: 5000 }), 0),
        ),
      ).toBe('accepted');
    expect(r.s.queueDepth).toBe(8);
    expect(r.s.admit(r.c.compile(program(morph(), 10, { policy: 'append' }), 0))).toBe(
      'queue_full',
    );
    expect(r.s.admit(r.c.compile(program(morph(), 11), 0))).toBe('accepted');
    r.s.cancel('next');
    expect(r.s.queueDepth).toBe(0);
    expect(r.s.busy).toBe(false);
  });
  it('replays deterministic scheduler state with same seed/clock', () => {
    const a = rig(),
      b = rig();
    for (const r of [a, b]) {
      r.s.admit(
        r.c.compile(
          program({
            type: 'sequence',
            children: [morph(), { type: 'wait', durationMs: 100 }, morph('wave')],
          }),
          0,
        ),
      );
      for (let t = 0; t <= 1500; t += 50) r.time(t);
    }
    expect(a.state).toEqual(b.state);
  });
  it('zero duration applies next tick and restore skips expired backlog', () => {
    const r = rig();
    r.s.admit(r.c.compile(program(morph('cloud', 0)), 0));
    expect(r.state.shape).toBe('sphere');
    r.time(1);
    expect(r.state.shape).toBe('cloud');
    r.s.admit(r.c.compile(program(morph(), 2), 1));
    r.s.admit(r.c.compile(program(morph('wave'), 3, { policy: 'append' }), 1));
    r.time(20000);
    expect(r.s.queueDepth).toBe(0);
    expect(r.codes).toContain('expired');
  });
});
