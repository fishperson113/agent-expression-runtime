import { expect, it } from 'vitest';
import { runSoakSampling } from '../integrations/live-soak-sampling.mjs';

it('retains an endpoint sample when a timer returns 13ms early and processing crosses twenty minutes', async () => {
  let clock = 0; const samples = [], waits = [];
  const result = await runSoakSampling({ start: 0, durationMs: 1200000, intervalMs: 30000, now: () => clock,
    wait: async ms => { waits.push(ms); clock += Math.max(0, ms - 13); } }, async elapsed => {
    samples.push(elapsed); clock += 13;
  });
  expect(samples.slice(-2)).toEqual([1199987, 1200000]);
  expect(result).toEqual({ sampledDurationMs: 1200000, sampleCount: 41 });
  expect(clock).toBe(1200013); expect(waits.at(-1)).toBe(0);
});
it('keeps requested duration independent of processing time and needs no extra sample at an exact endpoint', async () => {
  let clock = 500; const samples = [];
  const result = await runSoakSampling({ start: 500, durationMs: 100, intervalMs: 100, now: () => clock,
    wait: async ms => { clock += ms; } }, async at => { samples.push(at); clock += 25; });
  expect(samples).toEqual([100]); expect(result.sampledDurationMs).toBe(100); expect(clock).toBe(625);
});
it('rejects zero, negative and nonfinite duration/interval and invalid clocks without fabricating completion', async () => {
  const options = { start: 0, durationMs: 10, intervalMs: 10, now: () => 0, wait: async () => {} };
  for (const key of ['durationMs', 'intervalMs']) for (const value of [0, -1, NaN, Infinity]) {
    await expect(runSoakSampling({ ...options, [key]: value }, () => { throw Error('unexpected_sample'); })).rejects.toThrow('invalid_soak_sampling_options');
  }
  await expect(runSoakSampling({ ...options, now: () => NaN }, () => {})).rejects.toThrow('invalid_soak_sampling_clock');
  await expect(runSoakSampling({ ...options, start: 1 }, () => {})).rejects.toThrow('invalid_soak_sampling_clock');
});
it('propagates a failed sample rather than certifying a retained endpoint', async () => {
  let clock = 0;
  await expect(runSoakSampling({ start: 0, durationMs: 10, intervalMs: 10, now: () => clock,
    wait: async ms => { clock += ms; } }, () => { throw Error('sample_failed'); })).rejects.toThrow('sample_failed');
});
