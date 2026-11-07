import { expect, it } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { Scheduler } from '../src/core/runtime/scheduler';
import { TerminalEngine } from '../src/terminal/runtime';

const parts = () => [{ id: 'stroke', kind: 'curve', points: [[-0.7, 0.2, 0], [0, -0.5, 0], [0.7, 0.2, 0]], radius: 0.03,
  motion: { pivot: [0, 0, 0], translate: [0, 0.1, 0], rotate: [0, 0, 0.2], periodMs: 2000, phase: 0 } }];
const envelope = (body: unknown, seq = 1) => ({ v: 1, epoch: 'e', seq, kind: 'program', track: 'body', policy: 'replace', body });
it('compiles composition atomically, including macros, and detects geometry/morph conflicts', () => {
  const compiler = new Compiler(), body = { type: 'assemble', parts: parts(), durationMs: 500 };
  expect(compiler.compile(envelope(body), 0).kind).toBe('program');
  expect(() => compiler.compile(envelope({ ...body, parts: [{ ...parts()[0], radius: 1 }] }), 0))
    .toThrow(expect.objectContaining({ path: '$.body.parts[0].radius' }));
  expect(() => compiler.compile(envelope({ type: 'parallel', children: [body,
    { type: 'morph', target: 'sphere', durationMs: 500 }] }), 0)).toThrow('property_conflict');
  compiler.compile({ v: 1, epoch: 'e', seq: 2, kind: 'define', body: { name: 'gesture', revision: 1, params: {}, body } }, 0);
  expect(compiler.compile(envelope({ type: 'call', name: 'gesture', revision: 1, args: {} }, 3), 0).kind).toBe('program');
});
it('renders a custom curve and preserves particle identity on interrupted replacement and cancellation', () => {
  let now = 0; const engine = new TerminalEngine(() => now);
  try {
    const sphere = Buffer.from(engine.frame(160, 120));
    engine.express({ body: { type: 'assemble', parts: parts(), durationMs: 500 } });
    now = 250; engine.frame(160, 120); const before = engine.state.particlePositions!.slice();
    engine.express({ body: { type: 'assemble', parts: [{ id: 'body', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.6, 0.6, 0.1] }], durationMs: 500 } });
    engine.frame(160, 120); expect(engine.state.particlePositions).toEqual(before);
    now += 500; expect(engine.frame(160, 120)).not.toEqual(sphere);
    expect(engine.state.shape).toBe('assembled');
    engine.cancel(); const frozen = engine.state.particlePositions!.slice();
    now += 300; engine.frame(160, 120); expect(engine.state.particlePositions).toEqual(frozen);
    engine.express({ body: { type: 'morph', target: 'sphere', durationMs: 500 } });
    now += 500; engine.frame(160, 120); expect(engine.state.shape).toBe('sphere');
    expect([...engine.state.particlePositions!].every(Number.isFinite)).toBe(true);
  } finally { engine.dispose(); }
});
it('keeps part motion alive after admission completes, then freezes it on cancel', () => {
  let now = 0; const scheduler = new Scheduler({ now: () => now }, { apply() {}, dispose() {} }, { count() {} });
  scheduler.cancel('e'); scheduler.admit(new Compiler().compile(envelope({ type: 'assemble', parts: parts(), durationMs: 200 }), 0));
  now = 200; scheduler.tick(); const a = scheduler.state.particlePositions!.slice();
  now = 500; scheduler.tick(); expect(scheduler.state.particlePositions).not.toEqual(a);
  scheduler.cancel('new'); const frozen = scheduler.state.particlePositions!.slice();
  now = 1000; scheduler.tick(); expect(scheduler.state.particlePositions).toEqual(frozen); scheduler.dispose();
});
