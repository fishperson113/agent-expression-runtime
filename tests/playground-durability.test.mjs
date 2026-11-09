import { expect, it } from 'vitest';
import { PlaygroundSession } from '../integrations/playground-session.mjs';
import { LiveCompiler } from '../src/core/live/compiler';
import { Scheduler } from '../src/core/runtime/scheduler';

it('retains requested scene style after the program releases ownership', () => {
  const journal = new PlaygroundSession('s');
  const scene = { parts: [{ id: 'free-part', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.2, 0.3, 0.1] }],
    style: { color: '#123456', brightness: 0.8, pointSize: 1.2, dispersion: 0.4 }, flow: { field: 'pulse', strength: 0.1 } };
  const proposal = journal.propose({ sessionId: 's', expectedRevision: 0, operation: 'create', scene });
  let now = 0; const feedback = [];
  const scheduler = new Scheduler({ now: () => now }, { apply() {}, dispose() {} }, { count() {} }, (status, ir) => feedback.push({ status, kind: ir.kind }));
  const compiler = new LiveCompiler(); scheduler.cancel('e');
  for (const [i, command] of proposal.commands.entries()) {
    const { phase, ...expression } = command;
    scheduler.admit(compiler.compile({ v: 1, epoch: 'e', seq: i + 1, ...expression }, 0).program);
  }
  for (now of [0, 600, 850, 1200, 2000]) scheduler.tick();
  expect(scheduler.state.brightness).toBeCloseTo(0.8);
  expect(scheduler.state.pointSize).toBeCloseTo(1.2);
  expect(scheduler.state.dispersion).toBeCloseTo(0.4);
  for (const kind of ['program', 'state']) expect(feedback).toContainEqual({ status: 'completed', kind });
});
