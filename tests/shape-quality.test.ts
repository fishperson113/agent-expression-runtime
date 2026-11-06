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
it.each(['cancel', 'close', 'complete'])('restores neutral posture after %s', reason => {
  let now = 0;
  const scheduler = new Scheduler({ now: () => now }, { apply() {}, dispose() {} }, { count() {} });
  scheduler.cancel('e');
  scheduler.admit(new Compiler().compile({
    v: 1, epoch: 'e', seq: 1, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'shapeQuality', rise: 1, advance: 1, spread: 2, grow: 2, path: 'arc', durationMs: 100 },
  }, 0));
  now = 50;
  scheduler.tick();
  expect(Number(scheduler.state.rise)).toBeGreaterThan(0);
  if (reason === 'complete') { now = 100; scheduler.tick(); }
  else scheduler.cancel(reason === 'close' ? 'next-session' : 'next-epoch');
  now += 250;
  scheduler.tick();
  for (const [key, value] of Object.entries({ rise: 0, advance: 0, spread: 1, grow: 1, arcOffset: 0 }))
    expect(scheduler.state[key as keyof typeof scheduler.state]).toBeCloseTo(value);
});
it('coalesces matching flow effort across parallel branches and rejects conflicting values', () => {
  const compiler = new Compiler();
  const body = { type: 'parallel', children: [
    { type: 'morph', target: 'wall', durationMs: 200, effort: { flow: 0.6 } },
    { type: 'flow', field: 'orbit', strength: 0.5, durationMs: 500, effort: { flow: 0.6 } },
  ] };
  const envelope = { v: 1, epoch: 'e', seq: 1, kind: 'program', track: 'body', policy: 'replace', body };
  const ir = compiler.compile(envelope, 0);
  if (ir.kind !== 'program') throw Error('program required');
  expect(ir.ops.filter(op => op.property === 'effortFlow')).toHaveLength(1);
  expect(ir.ops.find(op => op.property === 'effortFlow')?.duration).toBe(500);
  body.children[1].effort.flow = 0.2;
  expect(() => compiler.compile(envelope, 0)).toThrow('property_conflict');
});
it('accepts posture baseline patches, restores them after programs, and clears them on a new epoch', () => {
  let now = 0;
  const compiler = new Compiler();
  const scheduler = new Scheduler({ now: () => now }, { apply() {}, dispose() {} }, { count() {} });
  scheduler.cancel('e');
  const stamp = { v: 1, epoch: 'e' };
  expect(scheduler.admit(compiler.compile({ ...stamp, seq: 1, kind: 'state',
    body: { rise: 0.2, advance: -0.2, spread: 0.8, grow: 1.2, durationMs: 0 } }, 0))).toBe('state');
  scheduler.tick();
  expect(scheduler.state.rise).toBe(0.2);
  scheduler.admit(compiler.compile({ ...stamp, seq: 2, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'shapeQuality', rise: 1, durationMs: 100 } }, 0));
  now = 100; scheduler.tick();
  now = 350; scheduler.tick();
  expect(scheduler.state.rise).toBeCloseTo(0.2);
  scheduler.cancel('new-session');
  now = 600; scheduler.tick();
  expect(scheduler.state.rise).toBe(0);
  expect(scheduler.state.grow).toBe(1);
});
