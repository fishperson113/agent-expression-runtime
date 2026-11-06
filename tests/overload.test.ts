import { it, expect } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { Scheduler } from '../src/core/runtime/scheduler';
it('100 records/sec for 30 simulated seconds bounds queue/cache; content and cancel keep progressing', () => {
  let now = 0,
    content = 0,
    dropped = 0;
  const c = new Compiler();
  const s = new Scheduler(
    { now: () => now },
    { apply() {}, dispose() {} },
    {
      count() {
        dropped++;
      },
    },
  );
  s.cancel('e');
  let maxQueue = 0;
  for (let i = 0; i < 3000; i++) {
    now = i * 10;
    content++;
    const ir = c.compile(
      {
        v: 1,
        epoch: 'e',
        seq: i,
        kind: 'program',
        track: 'body',
        policy: 'append',
        body: { type: 'morph', target: i % 2 ? 'wall' : 'wave', durationMs: 1000 },
      },
      now,
    );
    s.admit(ir);
    s.tick();
    maxQueue = Math.max(maxQueue, s.queueDepth);
  }
  expect(content).toBe(3000);
  expect(dropped).toBeGreaterThan(0);
  expect(maxQueue).toBeLessThanOrEqual(8);
  expect(c.sizes.cache).toBeLessThanOrEqual(64);
  s.cancel('next');
  expect(s.queueDepth).toBe(0);
});
