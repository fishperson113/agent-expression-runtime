import { randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareSession, runSession } from './start-session.mjs';

export function effortTrials(seed, perAxis = 20) {
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const trials = ['flow', 'time'].flatMap(axis => Array.from({ length: perAxis }, (_, i) => ({
    axis, higher: i % 2 === 0 ? 'a' : 'b',
    question: axis === 'flow' ? 'Which clip looked freer / less bound?' : 'Which clip began moving sooner?',
  })));
  for (let i = trials.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [trials[i], trials[j]] = [trials[j], trials[i]];
  }
  return trials;
}

export function summarizeEffort(responses) {
  return Object.fromEntries(['flow', 'time'].map(axis => {
    const rows = responses.filter(row => row.axis === axis);
    const n = rows.length, correct = rows.filter(row => row.answer === row.higher).length;
    const p = n ? correct / n : 0, z = 1.96;
    const lower = n ? (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) /
      (1 + z * z / n) : 0;
    return [axis, { trials: n, correct, unsure: rows.filter(row => row.answer === 'u').length,
      accuracyIncludingUnsure: p, wilson95Lower: lower,
      status: n < 20 ? 'unassessed' : lower > 0.5 ? 'detected-in-this-session' : 'not-demonstrated' }];
  }));
}

export function effortBody(axis, value) {
  return axis === 'flow'
    ? { type: 'style', brightness: 0.65, durationMs: 1200, effort: { flow: value } }
    : { type: 'morph', target: 'wall', durationMs: 1200, effort: { time: value } };
}

async function evaluator({ base, token, page, signal }) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const stop = () => terminal.close();
  signal.addEventListener('abort', stop, { once: true });
  const seed = randomBytes(4).readUInt32LE(), responses = [];
  let session;
  const api = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    const result = await response.json();
    if (!response.ok) throw Error(result.code ?? 'evaluation_gateway_error');
    return result;
  };
  try {
    session = await api('/v1/sessions', {});
    console.log('Blind comparison: watch A and B, then answer a / b / u (unsure). q saves and stops. Values stay hidden until the session ends.');
    for (const trial of effortTrials(seed)) {
      if (signal.aborted) break;
      console.log(`Trial ${responses.length + 1}/40: ${trial.question}`);
      for (const clip of ['a', 'b']) await playClip(api, session, page, trial, clip, signal);
      let answer;
      do { answer = (await terminal.question('a / b / u / q: ', { signal })).trim().toLowerCase(); }
      while (!['a', 'b', 'u', 'q'].includes(answer));
      if (answer === 'q') break;
      responses.push({ ...trial, answer });
    }
    return 0;
  } finally {
    terminal.close(); signal.removeEventListener('abort', stop);
    mkdirSync('.runtime', { recursive: true });
    writeFileSync('.runtime/effort-evaluation.json', JSON.stringify({ seed, responses,
      summary: summarizeEffort(responses), humanSession: true, timestamp: new Date().toISOString() }, null, 2));
    console.log('Saved .runtime/effort-evaluation.json. A single observer session is not population-level validation.');
  }
}

async function playClip(api, session, page, trial, clip, signal) {
  const cancelled = await api(`/v1/sessions/${session.id}/cancel`, { epoch: session.epoch });
  session.epoch = cancelled.epoch;
  const submit = async (body, kind = 'program') => {
    const command = { epoch: session.epoch, requestId: randomUUID(), body, kind };
    let receipt = await api(`/v1/sessions/${session.id}/expressions`, command);
    for (let i = 0; receipt.status === 'pending' && i < 4; i++) {
      await delay(100, undefined, { signal });
      receipt = await api(`/v1/sessions/${session.id}/expressions`, command);
    }
    if (receipt.status !== 'accepted') throw Error('evaluation_admission_unconfirmed');
  };
  await page.locator('#motion').uncheck();
  await submit({ dispersion: 0, brightness: 0.65, durationMs: 0 }, 'state');
  await submit({ type: 'parallel', children: [
    { type: 'morph', target: 'sphere', durationMs: 0 },
    { type: 'flow', field: 'orbit', strength: 0, durationMs: 0 },
  ] });
  await delay(400, undefined, { signal });
  console.log(`Clip ${clip.toUpperCase()}`);
  await submit(effortBody(trial.axis, clip === trial.higher ? 1 : 0));
  await delay(1500, undefined, { signal });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareSession({ withCodex: false }).then(() => runSession({ runHost: evaluator })).then(code => {
    process.exitCode = code;
  }).catch(() => { console.error('Evaluation stopped. Check the runtime and saved partial results.'); process.exitCode = 1; });
}
