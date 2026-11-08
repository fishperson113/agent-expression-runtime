import { expect, it } from 'vitest';
import { LiveCompositor } from '../src/core/live/compositor';
import { validateConfiguration } from '../src/core/live/control-validation';
import { transformMatrices, livePoint } from '../src/core/live/transforms';

const configuration = () => validateConfiguration({ lifetimeMs: 1000, poses: [], controls: [
  { type: 'bind', id: 'rhythm', signal: 'agent.output', target: { part: 'chosen', prop: 'scaleY' }, gain: 0.6, offset: 1, clamp: [1, 1.6], smoothMs: 40 },
  { type: 'reflex', id: 'arrive', when: { event: 'user_arrived' }, do: { type: 'pose', target: { part: 'chosen', prop: 'scaleY' }, value: 0.5, durationMs: 600 }, cooldownMs: 1000 },
] });
it('lets bindings override reflexes and semantic poses override bindings only on their channel', () => {
  const compositor = new LiveCompositor(), config = configuration(); compositor.install(config, 0); compositor.topology(['chosen']);
  compositor.event('user_arrived', 0);
  const writes = compositor.sample(300, null, 1);
  expect(writes[0].value).toBeGreaterThan(1);
  config.poses = [{ type: 'pose', target: { part: 'chosen', prop: 'scaleY' }, value: 0.5, durationMs: 600 }];
  compositor.install(config, 300);
  expect(compositor.sample(600, null, 1)[0].value).toBeLessThan(1);
});
it('drops old topology, expires leases, freezes motion-off and attenuates reduced motion', () => {
  const compositor = new LiveCompositor(); compositor.install(configuration(), 0); compositor.topology(['chosen']);
  const moving = compositor.sample(100, null, 1)[0].value;
  compositor.mode = 'off'; expect(compositor.sample(500, null, 0)[0].value).toBe(moving);
  compositor.mode = 'normal'; compositor.sample(1200, null, 1);
  expect(compositor.sample(1400, null, 1)[0].value).toBeLessThan(moving);
  compositor.topology(['other']); expect(compositor.sample(1500, null, 1)).toEqual([]);
  compositor.reset(); expect(compositor.sample(1600, null, 1)).toEqual([]);
});
it('scales around declared geometry center without accumulating drift or changing other parts', () => {
  const parts = [{ id: 'chosen', kind: 'ellipsoid' as const, center: [1, 0, 0] as [number, number, number], scale: [0.1, 0.1, 0.1] as [number, number, number] }];
  const matrices = transformMatrices([{ target: { part: 'chosen', prop: 'scaleX' }, value: 2 }], parts);
  expect(livePoint(1.1, 0, 0, matrices[1])[0]).toBeCloseTo(1.2);
  expect(livePoint(1.1, 0, 0, matrices[0])[0]).toBe(1.1);
  expect(parts[0].center).toEqual([1, 0, 0]);
});
