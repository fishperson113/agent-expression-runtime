import { it, expect } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { Scheduler } from '../src/core/runtime/scheduler';
import { convertClockOrigin } from '../src/adapters/clock-origin';
it('transit delay does not restart the admission deadline or TTL on the render worker', () => {
  const ir = new Compiler().compile(
    {
      v: 1,
      epoch: 'e',
      seq: 1,
      kind: 'program',
      track: 'body',
      policy: 'replace',
      body: { type: 'wait', durationMs: 100 },
    },
    100,
  );
  const translated = convertClockOrigin({ ...ir, deadlineAt: 550 }, 12000, 13000);
  expect(translated.receivedAt).toBe(-900);
  expect(translated.deadlineAt).toBe(-450);
  const s = new Scheduler(
    { now: () => 0 },
    {
      apply() {
        throw Error('must not apply');
      },
      dispose() {},
    },
    { count() {} },
  );
  // Set the epoch directly to isolate admission; no renderer frame is necessary.
  s.epoch = 'e';
  expect(s.admit(translated)).toBe('admission_timeout');
});
