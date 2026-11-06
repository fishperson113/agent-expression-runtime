import { it, expect } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { Scheduler } from '../src/core/runtime/scheduler';
it('crossfades field weights and replaces from the currently displayed mixture', () => {
  let now = 600000,
    seq = 0;
  const c = new Compiler();
  const s = new Scheduler({ now: () => now }, { apply() {}, dispose() {} }, { count() {} });
  s.cancel('e');
  const flow = (field: string) =>
    s.admit(
      c.compile(
        {
          v: 1,
          epoch: 'e',
          seq: ++seq,
          kind: 'program',
          track: 'body',
          policy: 'replace',
          body: { type: 'flow', field, strength: 0.5, durationMs: 1000, easing: 'linear' },
        },
        now,
      ),
    );
  flow('pulse');
  s.tick();
  expect(s.state.flowWeights).toEqual([1, 0, 0]);
  now += 500;
  s.tick();
  expect(s.state.flowWeights).toEqual([0.5, 0, 0.5]);
  flow('turbulence');
  s.tick();
  expect(s.state.flowWeights).toEqual([0.5, 0, 0.5]);
  now += 500;
  s.tick();
  expect(s.state.flowWeights).toEqual([0.25, 0.5, 0.25]);
});
