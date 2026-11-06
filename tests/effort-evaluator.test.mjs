import { expect, it } from 'vitest';
import { effortTrials, summarizeEffort, effortBody } from '../scripts/evaluate-effort.mjs';

it('produces reproducible, balanced blind trials without changing duration', () => {
  const first = effortTrials(42);
  expect(first).toEqual(effortTrials(42));
  expect(first).not.toEqual(effortTrials(43));
  for (const axis of ['flow', 'time']) {
    const rows = first.filter(trial => trial.axis === axis);
    expect(rows).toHaveLength(20);
    expect(rows.filter(trial => trial.higher === 'a')).toHaveLength(10);
    const lower = effortBody(axis, 0), higher = effortBody(axis, 1);
    expect(lower.durationMs).toBe(higher.durationMs);
    expect({ ...lower, effort: higher.effort }).toEqual(higher);
  }
});
it('does not claim perceptual validation without enough human judgments', () => {
  expect(summarizeEffort([]).flow.status).toBe('unassessed');
  expect(summarizeEffort(effortTrials(42, 2).map(trial => ({ ...trial, answer: trial.higher }))).time.status).toBe('unassessed');
});
it('counts unsure responses in the denominator and reports chance-level results honestly', () => {
  const allUnsure = effortTrials(42).map(trial => ({ ...trial, answer: 'u' }));
  const summary = summarizeEffort(allUnsure);
  expect(summary.flow.unsure).toBe(20);
  expect(summary.flow.accuracyIncludingUnsure).toBe(0);
  expect(summary.time.status).toBe('not-demonstrated');
  const perfect = summarizeEffort(effortTrials(42).map(trial => ({ ...trial, answer: trial.higher })));
  expect(perfect.flow.status).toBe('detected-in-this-session');
  expect(perfect.flow.wilson95Lower).toBeGreaterThan(0.5);
});
