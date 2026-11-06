import { expect, it } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { Scheduler } from '../src/core/runtime/scheduler';
it('motion primitives accept bounded effort annotations through the same compiler', () => {
  const c = new Compiler();
  for (const body of [
    { type: 'morph', target: 'wall' },
    { type: 'flow', field: 'pulse', strength: 0.4 },
    { type: 'style', brightness: 0.5 },
  ]) {
    const envelope = {
      v: 1,
      epoch: 'e',
      seq: 1,
      kind: 'program',
      track: 'body',
      policy: 'replace',
      body: { ...body, durationMs: 100, effort: { time: 0.2, weight: 0.4, flow: 0.3 } },
    };
    const ir = c.compile(envelope, 0) as any;
    expect(ir.ops.some((op: any) => op.property === 'effortFlow')).toBe(true);
    expect(() =>
      c.compile({ ...envelope, body: { ...envelope.body, effort: { flow: 2 } } }, 0),
    ).toThrow();
  }
});
it('absolute shape quality commands do not accumulate and replace from displayed state', () => {
  let now = 0;
  const c = new Compiler();
  const s = new Scheduler({ now: () => now }, { apply() {}, dispose() {} }, { count() {} });
  s.cancel('e');
  let seq = 0;
  const apply = (body: unknown) =>
    s.admit(
      c.compile(
        { v: 1, epoch: 'e', seq: ++seq, kind: 'program', track: 'body', policy: 'replace', body },
        now,
      ),
    );
  apply({ type: 'shapeQuality', rise: 0.8, spread: 1.5, durationMs: 1000, easing: 'linear' });
  s.tick();
  now = 500;
  s.tick();
  expect(s.state.rise).toBeCloseTo(0.4);
  apply({ type: 'shapeQuality', rise: 0.8, spread: 1.5, durationMs: 1000, easing: 'linear' });
  s.tick();
  expect(s.state.rise).toBeCloseTo(0.4);
  now = 1500;
  s.tick();
  expect(s.state.rise).toBeCloseTo(0.8);
  expect(s.state.spread).toBeCloseTo(1.5);
  apply({ type: 'shapeQuality', rise: 0.8, spread: 1.5, durationMs: 0 });
  s.tick();
  expect(s.state.rise).toBeCloseTo(0.8);
  expect(s.state.spread).toBeCloseTo(1.5);
});
it('arc and effort stay bounded, finish at target, and reject invalid parameters', () => {
  const c = new Compiler();
  const program = (body: unknown) => ({
    v: 1,
    epoch: 'e',
    seq: 1,
    kind: 'program',
    track: 'body',
    policy: 'replace',
    body,
  });
  expect(() => c.compile(program({ type: 'shapeQuality', rise: 2, durationMs: 1 }), 0)).toThrow();
  expect(() =>
    c.compile(program({ type: 'shapeQuality', grow: 1, path: 'arc', durationMs: 1 }), 0),
  ).toThrow('arc_requires_translation');
  expect(() =>
    c.compile(program({ type: 'shapeQuality', rise: 1, effort: { weight: 2 }, durationMs: 1 }), 0),
  ).toThrow();
  let now = 0;
  const s = new Scheduler({ now: () => now }, { apply() {}, dispose() {} }, { count() {} });
  s.cancel('e');
  s.admit(
    c.compile(
      program({
        type: 'shapeQuality',
        rise: 1,
        path: 'arc',
        effort: { time: 0.8, weight: 1 },
        durationMs: 100,
      }),
      0,
    ),
  );
  for (now = 0; now <= 100; now += 10) {
    s.tick();
    expect(Number(s.state.rise)).toBeLessThanOrEqual(1);
    expect(Math.abs(Number(s.state.arcOffset))).toBeLessThanOrEqual(0.251);
  }
  expect(s.state.rise).toBe(1);
  expect(Number(s.state.arcOffset)).toBeCloseTo(0);
});
it('free-flow effort releases to a bound baseline after the motion ends', () => {
  let now = 0;
  const s = new Scheduler({ now: () => now }, { apply() {}, dispose() {} }, { count() {} });
  s.cancel('e');
  s.admit(
    new Compiler().compile(
      {
        v: 1,
        epoch: 'e',
        seq: 1,
        kind: 'program',
        track: 'body',
        policy: 'replace',
        body: { type: 'shapeQuality', rise: 0.3, effort: { flow: 1 }, durationMs: 100 },
      },
      0,
    ),
  );
  now = 50;
  s.tick();
  expect(Number(s.state.effortFlow)).toBeGreaterThan(0);
  now = 100;
  s.tick();
  now = 350;
  s.tick();
  expect(Number(s.state.effortFlow)).toBeCloseTo(0);
});
