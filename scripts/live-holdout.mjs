import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openLive, liveRoot, closeLiveResources } from '../integrations/live-launch.mjs';
import { openModelClient, runModelTurn } from '../integrations/live-model-client.mjs';
import { readModelBudget, reserveModelTurn } from '../integrations/live-model-budget.mjs';
import { blindCodes, writeScoringPack, startBodyVideo, finishBodyVideo } from '../integrations/live-holdout-video.mjs';
import { holdoutCapture } from '../integrations/live-holdout-capture.mjs';

const prompts = JSON.parse(readFileSync(new URL('../integrations/live-holdout.json', import.meta.url), 'utf8'));
const directory = resolve(liveRoot, '.runtime/live-overnight');
const budgetPath = resolve(directory, 'model-budget.json');

function rejectionCodes(calls) {
  const codes = new Set();
  for (const call of calls) for (const content of call.result?.content ?? []) {
    if (content.type !== 'text') continue;
    try {
      const value = JSON.parse(content.text);
      if (value.status === 'rejected' && typeof value.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value.code)) codes.add(value.code);
    } catch { /* Only fixed machine codes are retained. */ }
  }
  return [...codes];
}
export function scoreContract(turn, metrics) {
  const calls = turn.tools.filter(item => item.server === 'fisch_live' && ['express', 'return_to_face'].includes(item.tool));
  const receipts = [], rejected = [];
  for (const call of calls) {
    if (call.error || call.result?.isError) { rejected.push(true); continue; }
    for (const content of call.result?.content ?? []) {
      if (content.type !== 'text') continue;
      try { const receipt = JSON.parse(content.text); if (receipt.status === 'accepted') receipts.push(receipt);
        else if (receipt.status === 'rejected') rejected.push(true); } catch { /* Non-receipt text is not evidence. */ }
    }
  }
  const events = metrics.diagnostics.events;
  const reached = phase => receipts.filter(receipt => events.some(event => event.seq === receipt.seq && event.epoch === receipt.epoch && event.phase === phase)).length;
  return { turnStatus: turn.status, attempted: calls.length, rejected: rejected.length, admitted: receipts.length,
    applied: reached('applied'), frameSubmitted: reached('frame_submitted'), frameChangedProxy: reached('frame_changed_proxy'),
    contractValidity: calls.length ? receipts.length / calls.length : null, rejectionCodes: rejectionCodes(calls), toolHistoryTruncated: !!turn.truncated,
    visualEffectiveness: null, contentRelevance: null, semanticConsistency: null };
}
export async function runHoldout() {
  if (process.env.FISCH_RUN_MODEL_TESTS !== '1') throw Error('Model tests are opt-in: set FISCH_RUN_MODEL_TESTS=1; the shared counter and deadline still apply.');
  if (prompts.length !== 10) throw Error('Expected ten frozen holdout prompts');
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  const initial = readModelBudget(budgetPath);
  if (Date.now() >= Date.parse(initial.deadline) || initial.used >= initial.limit) throw Error('Model test deadline or budget exhausted');
  mkdirSync(directory, { recursive: true });
  const live = await openLive({ headless: true, synthetic: true }); let client;
  const rows = [], codes = blindCodes(20);
  writeScoringPack(directory, codes);
  try {
    client = await openModelClient(live);
    for (let pass = 1; pass <= 2; pass++) {
      const result = await client.call('thread/start', { cwd: liveRoot, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request' });
      const threadId = result.thread.id; client.focus(threadId);
      for (const prompt of prompts) {
        const budget = reserveModelTurn(budgetPath, `holdout-${prompt.id}-pass-${pass}`);
        const capture = holdoutCapture(live.page, directory, `holdout-${prompt.id}-pass-${pass}`);
        mkdirSync(resolve(directory, 'private'), { recursive: true });
        const code = codes[rows.length], started = await startBodyVideo(live.page); let firstTool;
        const turn = await runModelTurn(client, threadId, prompt.prompt, Math.max(1, Math.min(90000, Date.parse(budget.deadline) - Date.now())), item => { capture.capture(item); if (item.server === 'fisch_live' && ['express', 'return_to_face'].includes(item.tool)) firstTool ??= Date.now(); });
        writeFileSync(resolve(directory, 'private', code + '.json'), JSON.stringify({ id: prompt.id, pass, status: turn.status, started, firstTool }, null, 2));
        await live.page.waitForTimeout(10500);
        const video = await finishBodyVideo(live.page, directory, code, started, firstTool, turn.status === 'completed');
        if (turn.status !== 'completed') throw Error('model_turn_failed');
        const activeEvidence = await capture.finish();
        await live.page.waitForTimeout(600);
        const metrics = await live.page.evaluate(() => window.fischLive.metrics());
        await live.page.locator('#body').screenshot({ path: resolve(directory, `holdout-${prompt.id}-pass-${pass}.png`) });
        rows.push({ id: prompt.id, pass, ...scoreContract(turn, metrics), activeEvidence, video });
        writeFileSync(resolve(directory, 'answer-key.json'), JSON.stringify(rows.map(row => ({ code: row.video.code, id: row.id, pass: row.pass, prompt: prompts.find(p => p.id === row.id).prompt })), null, 2));
        writeFileSync(resolve(directory, 'holdout-report.json'), JSON.stringify({ environment: 'Cloud Linux / headless software rendering / synthetic camera',
          modelTurnsUsed: readModelBudget(budgetPath).used, humanRecognition: 'pending', rows }, null, 2));
      }
    }
    return rows;
  } catch (error) {
    writeFileSync(resolve(directory, 'holdout-report.json'), JSON.stringify({ status: 'failed',
      errorCode: error.message.match(/^[a-z_]+/)?.[0] ?? 'model_test_failed', modelTurnsUsed: readModelBudget(budgetPath).used, rows }, null, 2));
    throw error;
  } finally { await closeLiveResources([() => client?.close(), () => live.close()]); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--describe')) console.log(JSON.stringify({ prompts: prompts.map(item => item.id), passes: 2, requestedTurns: 20, budget: readModelBudget(budgetPath) }));
  else runHoldout().then(rows => console.log(JSON.stringify(rows))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
