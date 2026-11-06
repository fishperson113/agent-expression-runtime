import { expect, it } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { Scheduler } from '../src/core/runtime/scheduler';
it('state completes only after program ownership and baseline blend finish; cancel terminates pending feedback', () => {
  let now = 0;
  const events: string[] = [];
  const c = new Compiler();
  const s = new Scheduler(
    { now: () => now },
    { apply() {}, dispose() {} },
    { count() {} },
    (status, ir) => events.push(`${ir.seq}:${status}`),
  );
  s.cancel('e');
  const p = (seq: number, body: unknown) =>
    c.compile(
      { v: 1, epoch: 'e', seq, kind: 'program', track: 'body', policy: 'replace', body },
      now,
    );
  s.admit(p(1, { type: 'style', brightness: 1, durationMs: 1000 }));
  s.tick();
  s.admit(
    c.compile(
      { v: 1, epoch: 'e', seq: 2, kind: 'state', body: { brightness: 0.2, durationMs: 100 } },
      now,
    ),
  );
  now = 200;
  s.tick();
  expect(events).not.toContain('2:completed');
  now = 1000;
  s.tick();
  expect(events).not.toContain('2:completed');
  now = 1250;
  s.tick();
  expect(events).toContain('2:completed');
  s.admit(p(3, { type: 'wait', durationMs: 1000 }));
  s.cancel('next');
  expect(events).toContain('3:cancelled');
});
