import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanupOwned, parseArguments, summarizeNumbers, sourceSha } from '../scripts/reactive-wall-probe.mjs';
import { opportunityReport } from '../scripts/reactive-opportunities-report.mjs';

const bytes = readFileSync(new URL('../docs/evidence/reactive-wall-354d642.json', import.meta.url));
const report = JSON.parse(bytes);
const sum = object => Object.values(object).reduce((total, n) => total + n, 0);

it('preserves the original whole-window artifact and browser fixture provenance byte for byte', () => {
  expect(bytes.length).toBe(7615);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('bbd7e415ced56a93c280adc44608fb021f1279a45d41cdcfe3e3c6fc49ccaa6a');
  const fixture = readFileSync(new URL('../integrations/reactive-wall-page.mjs', import.meta.url));
  expect(createHash('sha256').update(fixture).digest('hex')).toBe('a3cd7530b426819cd829464b2ec31253367d3eb2bb45f74f3f688301146c4b3a');
  expect(report.sourceSha).toBe(sourceSha);
  expect(report.mode).toBe('--run-approved');
  expect(report.hostElapsedMs).toBeGreaterThanOrEqual(1200000);
  expect(report.browserElapsedMs).toBeGreaterThanOrEqual(1200000);
  expect(report.plan).toEqual({ quietMs: 600000, activeMs: 600000 });
  expect(report.realModelCalls).toBe(0); expect(report.cameraOrMicrophoneCalls).toBe(0);
});

it('keeps opportunity cohorts, full-window freshness and endpoint censoring arithmetically consistent', () => {
  let sourceFrames = 0, requests = 0;
  for (const name of ['quiet', 'active']) {
    const phase = report.browser.phases[name], provider = report.providerByOpportunityCohort[name];
    sourceFrames += phase.sourceFrames; requests += provider.requested;
    expect(phase.validSourceFrames).toBeLessThanOrEqual(phase.sourceFrames);
    expect(phase.sourceValidSemanticOpportunities).toBeLessThanOrEqual(phase.semanticOpportunities);
    expect(sum(phase.eventTypes)).toBe(phase.semanticOpportunities);
    expect(phase.authorized).toBeLessThanOrEqual(phase.candidates);
    expect(provider.requested).toBeLessThanOrEqual(phase.authorized);
    expect(provider.returned + report.providerOutstandingAtEnd[name]).toBe(provider.requested);
    expect(sum(phase.decisions)).toBeLessThanOrEqual(provider.returned);
    for (const key of ['admitted', 'applied', 'completed', 'frame_submitted', 'frame_changed_proxy'])
      expect(phase.uniqueOwnedRequests[key] ?? 0).toBeLessThanOrEqual(phase.admissionCallbacks);
    for (const silence of [phase.longestAppliedSilence, phase.longestCompletedSilence]) {
      expect(silence.to - silence.from).toBeCloseTo(silence.milliseconds);
      expect(silence.semanticOpportunities).toBeLessThanOrEqual(phase.semanticOpportunities);
    }
  }
  expect(report.browser.sourceGapMs.count).toBe(sourceFrames - 1);
  expect(report.brokerAtEnd.uniqueRequests).toBe(requests);
  expect(report.browser.finalStatus.dispatches).toBe(requests);
  expect(report.actualProviderLatencyMs.count).toBe(report.providerByOpportunityCohort.quiet.returned + report.providerByOpportunityCohort.active.returned);
  expect(report.actualPollGapMs.count).toBe(report.pollCount - 1);
  expect(report.browser.aggregateOverflow).toBe(0);
  expect(report.browser.phases.quiet.elapsedMs + report.browser.phases.active.elapsedMs).toBeCloseTo(report.browserElapsedMs);
  expect(report.browser.censoredAtEnd.browserTransport).toBeGreaterThanOrEqual(0);
});

it('requires explicit run modes and summarizes all supplied timing observations', () => {
  expect(parseArguments([]).plan).toEqual({ quietMs: 20000, activeMs: 30000 });
  expect(parseArguments(['--help'])).toBeNull();
  expect(parseArguments(['--smoke']).plan).toEqual({ quietMs: 20000, activeMs: 30000 });
  expect(parseArguments(['--full']).plan).toEqual({ quietMs: 600000, activeMs: 600000 });
  expect(() => parseArguments(['--unknown'])).toThrow('probe_arguments');
  expect(() => parseArguments(['--full', '--smoke'])).toThrow('probe_arguments');
  expect(summarizeNumbers([])).toMatchObject({ count: 0, p95: null });
  expect(summarizeNumbers([2241, 100, 101, 99, 102])).toEqual({ count: 5, min: 99, max: 2241, p50: 101, p95: 2241 });
});

it('links the separate wall evidence while preserving each generated virtual source label', () => {
  const text = opportunityReport({ runKind: 'formatter test', sourceSha: 'future123', baselineSha: sourceSha,
    sameExecutedSourcesAsBaseline: false, changedFromBaseline: [], generatedAt: 'synthetic', elapsedHostMs: 0 },
  { durationMs: 1200000, rows: [], controls: [] });
  expect(text).toContain('(reactive-wall-evidence.md)');
  expect(text).toContain('regenerated at `future1`');
  const archived = readFileSync(new URL('../docs/reactive-opportunities-results.md', import.meta.url), 'utf8');
  expect(archived).toContain('regenerated at `dc66412`');
  expect(archived).not.toContain('gate is **pending**');
});

it('attempts every owned cleanup despite failures and never masks the original probe error', async () => {
  const calls = [], failure = Error('original probe failure');
  const runtime = { broker: { close() { calls.push('broker'); throw Error('broker close'); } },
    browser: { async close() { calls.push('browser'); throw Error('browser close'); } },
    server: { async close() { calls.push('server'); } } };
  const operation = async () => {
    try { throw failure; }
    finally { await cleanupOwned(runtime, () => { calls.push('snapshot'); throw Error('snapshot remove'); }); }
  };
  await expect(operation()).rejects.toBe(failure);
  expect(calls).toEqual(['broker', 'browser', 'server', 'snapshot']);
});

it('keeps the additional current-core controls explicitly virtual and arithmetically consistent', () => {
  const control = JSON.parse(readFileSync(new URL('../docs/evidence/reactive-current-hand-controls.json', import.meta.url)));
  expect(control.execution).toContain('virtual'); expect(control.execution).toContain('not a wall/browser run');
  expect(control.sourceSha).toMatch(/^[a-f0-9]{40}$/); expect(control.runtimeBase).toMatch(/^[a-f0-9]{7,40}$/);
  expect(readFileSync(new URL('../docs/reactive-wall-evidence.md', import.meta.url), 'utf8')).toContain(control.sourceSha);
  expect(control.pollMs).toBe(100); expect(control.particles).toBe(64); expect(control.rows).toHaveLength(2);
  for (const row of control.rows) {
    expect(row.actualGpuFramesMeasured).toBe(false); expect(row.frames).toBe(24000);
    expect(row.validSourceFrames / row.frames).toBe(row.sourceValidityRatio);
    expect(row.decisionsReturned + row.outstandingAtEnd).toBe(row.providerRequested);
    expect(sum(row.verdicts)).toBe(row.decisionsReturned);
    expect(row.candidateEligible).toBeGreaterThanOrEqual(row.providerRequested);
  }
});
