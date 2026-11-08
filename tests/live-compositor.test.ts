import { expect, it } from 'vitest';
import { LiveCompositor, composeWrites } from '../src/core/live/compositor';
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

it('releases ownership after a semantic lease so lower facial reflexes can resume smoothly', () => {
  const compositor = new LiveCompositor(); compositor.install(configuration(), 0); compositor.topology(['chosen']);
  for (let at = 0; at < 1000; at += 20) compositor.sample(at, null, 1);
  for (let at = 1000; at < 4000; at += 20) compositor.sample(at, null, 1);
  expect(compositor.sample(4000, null, 1)).toEqual([]);
});

it('crossfades an expiring semantic channel back to its current lower layer', () => {
  const target = { part: 'mouth', prop: 'scaleY' as const };
  const lower = [{ target, value: 0.4 }];
  expect(composeWrites([lower, [{ target, value: 1.4, weight: 1 }]])[0].value).toBeCloseTo(1.4);
  expect(composeWrites([lower, [{ target, value: 1.4, weight: 0.5 }]])[0].value).toBeCloseTo(0.9);
  expect(composeWrites([lower, [{ target, value: 1.4, weight: 0 }]])[0].value).toBeCloseTo(0.4);
});

it('applies the reserved body channel once even when an illustration has a part named body', () => {
  const parts = [{ id: 'body', kind: 'ellipsoid' as const, center: [0, 0, 0] as [number, number, number], scale: [0.1, 0.1, 0.1] as [number, number, number] }];
  const matrices = transformMatrices([{ target: { part: 'body', prop: 'x' }, value: 0.2 }], parts);
  const local = livePoint(0.1, 0, 0, matrices[1]);
  expect(livePoint(...local, matrices[0])[0]).toBeCloseTo(0.3);
});
