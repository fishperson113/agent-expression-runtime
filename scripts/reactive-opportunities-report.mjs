import { writeFile } from 'node:fs/promises';

const phases = row => [row.providerRequested, row.admitted, row.phases.applied ?? 0, row.phases.completed ?? 0, row.phases.cancelled ?? 0].join('/');
const csvValue = value => '"' + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll('"', '""') + '"';
const sum = values => Object.values(values).reduce((total, value) => total + value, 0);

function csv(rows) {
  const flat = rows.map(({ longestAppliedSilence, longestCompletedSilence, ...row }) => ({ ...row,
    longestAppliedSilenceMs: longestAppliedSilence.milliseconds,
    longestAppliedSilenceFrom: longestAppliedSilence.from, longestAppliedSilenceTo: longestAppliedSilence.to,
    opportunitiesInAppliedSilence: longestAppliedSilence.semanticOpportunities,
    longestCompletedSilenceMs: longestCompletedSilence.milliseconds,
    opportunitiesInCompletedSilence: longestCompletedSilence.semanticOpportunities }));
  const headers = Object.keys(flat[0]);
  return [headers.map(csvValue).join(','), ...flat.map(row => headers.map(key => csvValue(row[key])).join(','))].join('\n') + '\n';
}

function matrix(rows) {
  const periodic = rows.filter(row => row.mode === 'fresh' && row.seed === 0);
  const rates = [...new Set(periodic.map(row => row.rate))];
  const latencies = [...new Set(periodic.map(row => row.latency))];
  return ['| Raw flips/s | Raw flips | Classifier opportunities | ' + latencies.map(value => value + ' ms').join(' | ') + ' |',
    '| --- | --- | --- | ' + latencies.map(() => '---').join(' | ') + ' |',
    ...rates.map(rate => {
      const selected = periodic.filter(row => row.rate === rate);
      return '| ' + [rate, selected[0].rawScoreChanges, selected[0].semanticOpportunities, ...selected.map(phases)].join(' | ') + ' |';
    })].join('\n');
}

function controlsTable(controls) {
  return ['| Raw flips/s | Source-valid frames | Opportunities | Requests/admitted/applied/completed/cancelled | Longest application silence (opportunities) |',
    '| --- | --- | --- | --- | --- |', ...controls.map(row => '| ' + [row.rate,
      `${row.validSourceFrames}/${row.frames}`, row.semanticOpportunities, phases(row),
      `${row.longestAppliedSilence.milliseconds} ms (${row.longestAppliedSilence.semanticOpportunities})`].join(' | ') + ' |')].join('\n');
}

function selectedRows(rows) {
  const picked = rows.filter(row => row.mode !== 'fresh' || (row.seed === 9011 && row.rate === 0.5 && row.latency === 2000) ||
    (row.seed === 0 && ((row.rate === 0.05 && row.latency === 4500) || (row.rate === 0.5 && row.latency === 100))));
  return ['| Mode / seed | Raw flips/s / delay | Classifier events | Requests/admitted/applied/completed/cancelled | In-flight first revocation reasons | Actual action cancellation reasons |',
    '| --- | --- | --- | --- | --- | --- |', ...picked.map(row => '| ' + [
      `${row.mode} / ${row.seed}`, `${row.rate} / ${row.latency} ms`, row.semanticOpportunities, phases(row),
      JSON.stringify(row.firstRequestRevocations), JSON.stringify(row.actualCancelReasons)].join(' | ') + ' |')].join('\n');
}

export function opportunityReport(metadata, result) {
  const { durationMs, rows, controls } = result;
  const matching = metadata.sameExecutedSourcesAsBaseline;
  const minutes = durationMs / 60000;
  return [`# Reactive opportunity diagnostics — ${metadata.runKind}`, '',
    `${rows.length} scenarios × **${minutes} virtual minutes**; this is not a real-wall soak, model measurement or human session.`, '',
    `Runtime checkout: \`${metadata.sourceSha}\`. Baseline reference: \`${metadata.baselineSha}\`. Executed source files match baseline: **${matching}**.`,
    matching === null ? 'The baseline git object is unavailable; no source identity comparison was made.' : matching
      ? 'Runtime input bytes are identical to the baseline for this probe.' : 'Executed sources differ from the baseline; these counts were regenerated and must not be labeled the old snapshot.',
    `Changed/missing executed inputs: ${metadata.changedFromBaseline.length ? metadata.changedFromBaseline.map(path => '`' + path + '`').join(', ') : 'none'}.`, '',
    '## Measurement', '',
    'Actual FaceObservations consumes synthetic detector scores and uniform dummy landmarks at 20 Hz, with continuous position motion. ReactiveSession, LiveCompiler and Scheduler use a 50 ms virtual clock. The main matrix checks takeRequest every 50 ms; separate controls check every 100 ms to match broker polling cadence. No broker, provider transport, camera, microphone, model or ThreeRenderer runs here. Diagnostic particle count is 64, not the product performance tier.', '',
    'Raw rate means score-target flips per second. It is not camera FPS or measured natural-human traffic. Actual expression smoothing/hysteresis plus 300 ms debounce determines classifier opportunities; initial presence arrival uses 1 s. Orientation debounce is 700 ms but is not varied. Raw motion alone is not a semantic opportunity.', '',
    'Funnel: raw flips → actual classifier events → source-eligible events → actual takeRequest candidates → authorized fake-provider requests → returned decisions/native verdicts → admitted → Scheduler applied → completed/cancelled. CSV retains every row, source-validity denominator and all reason dictionaries. In-flight first revocation reasons are distinct from lease callbacks and actual action cancellations.', '',
    'Responses always return a valid diagnostic 600 ms shapeQuality phrase, with validUntil equal to the actual request deadline. This measures timing, not relevance. The baseline policy is 750 ms first-pending-event coalescing, 15 s minimum interval, four starts per minute and 5 s request lifetime. Observed request lifetimes are stored per row; no guard is changed by this tool.', '',
    '## Main matrix', '', 'Cells = requested / admitted / applied / completed / actual action cancelled.', '', matrix(rows), '',
    '## Selected reasons and source controls', '', selectedRows(rows), '',
    'The source-loss control stops synthetic observations for 2 s per 20 s. The user-busy control owns the user lane for 5 s per 30 s. These cohorts are separate from the continuously fresh main matrix; phase alignment may leave the same capped start count despite busy intervals.', '',
    '## 100 ms polling controls', '', controlsTable(controls), '',
    '## Interpretation limits', '',
    '- The intentional four-per-minute cap limits dispatches; non-dispatched opportunities are not automatically provider failures.',
    '- Applied is not completed. A response near expiry may apply yet have insufficient lease left to finish its phrase.',
    '- Lease revocation after an already completed action is not an incomplete action. Read actual cancellation counts separately.',
    '- Coalescing is first-pending-event anchored in the inspected baseline, not restarted by every coalesced event. Do not infer last-event debounce starvation.',
    '- Application silence must be read with its opportunity count. Long quiet silence with no new opportunities is expected.',
    '- Silence refers only to attributed reactive Scheduler application; ambient presence/local reflexes may still animate.',
    '- Numerical sink calls and changed state are not actual GPU frame submissions, semantic meaning, enjoyment or native performance.',
    '- Synthetic periodic/jitter input does not establish natural incidence or real model latency. No policy change is recommended from this matrix alone.', '',
    `The separate [real-wall browser/broker report](reactive-wall-evidence.md) records a full 20-minute synthetic run at source \`354d642\`, with whole-window quiet/active opportunity cohorts and owned frame proxies. This virtual report was regenerated at \`${metadata.sourceSha.slice(0, 7)}\`; do not conflate the snapshots or substitute a rolling 60-second recorder for either method.`, '',
    '## Reproduce', '', '```sh', 'npm ci', 'node scripts/reactive-opportunities.mjs --output .runtime/reactive-opportunities',
    'node scripts/reactive-opportunities.mjs --quick --output .runtime/reactive-opportunities-quick', '```', '',
    'The launcher bundles actual repository imports into a disposable temporary file, then removes it. No bundled or archived runtime copy is committed. Exit failure indicates a harness/build/accounting error, never a target reaction rate. The diagnostic does not assert zero reactions as desired behavior.', '',
    `Generated ${metadata.generatedAt}; host execution ${metadata.elapsedHostMs} ms. Main returned decisions: ${rows.reduce((n, row) => n + row.decisionsReturned, 0)}; native verdict count: ${rows.reduce((n, row) => n + sum(row.verdicts), 0)}.`, ''].join('\n');
}

export async function writeOpportunityArtifacts(prefix, metadata, result, reportPath = prefix + '.md') {
  const summary = { ...metadata, durationMs: result.durationMs, mainScenarioCount: result.rows.length,
    accountingChecks: 'passed', controlsPollMs: 100, controls: result.controls };
  await Promise.all([writeFile(prefix + '.csv', csv(result.rows)), writeFile(prefix + '.json', JSON.stringify(summary, null, 2) + '\n'),
    writeFile(reportPath, opportunityReport(metadata, result))]);
}
