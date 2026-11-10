import { expect, it } from 'vitest';
import { LiveCompiler } from '../src/core/live/compiler';
import { Scheduler } from '../src/core/runtime/scheduler';
import { ExpressionLifecycle } from '../src/core/live/expression-lifecycle';

function fixture() {
  let now = 0;
  const events: string[] = [];
  const lifecycle = new ExpressionLifecycle((status, ir) => events.push(`${ir.seq}:${status}`));
  const scheduler = new Scheduler({ now: () => now }, { apply() {}, dispose() {} }, { count() {} },
    (status, ir) => lifecycle.feedback(status, ir), 10);
  scheduler.cancel('e');
  const compiled = new LiveCompiler().compile({ v: 1, epoch: 'e', seq: 1, kind: 'program',
    track: 'body', policy: 'replace', body: { type: 'live', program: null, configuration: {
      controls: [], poses: [{ type: 'pose', target: { part: 'body', prop: 'x' }, value: 0.1, durationMs: 8000 }], lifetimeMs: 8000 } } }, 0);
  expect(scheduler.admit(compiled.program)).toBe('accepted');
  if (compiled.program.kind === 'define') throw Error('fixture');
  lifecycle.configuration(compiled.program, 8000);
  const tick = (time: number) => { now = time; scheduler.tick(); lifecycle.tick(now); };
  return { events, lifecycle, scheduler, tick, ir: compiled.program };
}
it('does not report an eight-second configuration completed after the zero-duration scheduler program', () => {
  const f = fixture(); f.tick(0); f.tick(470);
  expect(f.events).toEqual(['1:applied']);
  f.lifecycle.cancel(); f.scheduler.cancel('next', false); f.tick(9000);
  f.lifecycle.feedback('completed', f.ir);
  expect(f.events).toEqual(['1:applied', '1:cancelled']);
});
it('completes only after both program and configuration lease, and keeps true completion terminal', () => {
  const f = fixture(); f.tick(0); f.tick(8000);
  expect(f.events).toEqual(['1:applied']);
  f.tick(8001); f.lifecycle.cancel();
  expect(f.events).toEqual(['1:applied', '1:completed']);
});
