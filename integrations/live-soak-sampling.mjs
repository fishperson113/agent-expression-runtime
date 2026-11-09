/** Finish on a retained sample timestamp, never on time spent processing an earlier sample. */
export async function runSoakSampling({ start, durationMs, intervalMs, now, wait }, sample) {
  if (![start, durationMs, intervalMs].every(Number.isFinite) || start < 0 || durationMs <= 0 || intervalMs <= 0 ||
    typeof now !== 'function' || typeof wait !== 'function' || typeof sample !== 'function') throw Error('invalid_soak_sampling_options');
  let sampledDurationMs = 0, sampleCount = 0;
  const elapsed = () => {
    const value = now() - start;
    if (!Number.isFinite(value) || value < sampledDurationMs) throw Error('invalid_soak_sampling_clock');
    return value;
  };
  do {
    const beforeWait = elapsed();
    await wait(Math.max(0, Math.min(intervalMs, durationMs - beforeWait)));
    const at = elapsed();
    if (at < beforeWait) throw Error('invalid_soak_sampling_clock');
    await sample(at);
    sampledDurationMs = at; sampleCount++;
  } while (sampledDurationMs < durationMs);
  return { sampledDurationMs, sampleCount };
}
