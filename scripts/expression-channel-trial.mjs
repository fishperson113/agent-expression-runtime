import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openLive, liveRoot } from '../integrations/live-launch.mjs';
import { openModelClient } from '../integrations/live-model-client.mjs';
import { readModelBudget, reserveModelTurn } from '../integrations/live-model-budget.mjs';
import { startBodyVideo, finishBodyVideo, blindCodes } from '../integrations/live-holdout-video.mjs';
import { ExpressionResponseChannel, expressionResponseSchema, runChannelTurn, isBodyMutation } from '../integrations/expression-response.mjs';
import { compositionSchema } from '../integrations/compose-expression.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
const textValue = result => { if (result?.isError) throw Error('thread_mcp_tool_error'); return JSON.parse(result.content?.find(c => c.type === 'text')?.text ?? 'null'); };
const toolCall = (client, threadId, tool, args = {}) => client.call('mcpServer/tool/call', { threadId, server: 'fisch_live', tool, arguments: args });
function policyAudit(expected) {
  const rows = [];
  return { rows, receive(message) {
    if (!['thread/start', 'thread/resume'].includes(message.method)) return;
    const value = message.params?.developerInstructions;
    rows.push({ method: message.method, exactBundlePresent: typeof value === 'string' && value.includes(expected),
      hash: typeof value === 'string' ? hash(value) : null, bytes: typeof value === 'string' ? Buffer.byteLength(value) : null,
      markerCount: typeof value === 'string' ? value.split('FISCH_LIVE_BODY').length - 1 : 0 });
  } };
}
async function preflight(client, threadId, audit) {
  if (audit.rows.length !== 1 || !audit.rows[0].exactBundlePresent || audit.rows[0].markerCount !== 1) throw Error('effective_policy_unverified');
  const catalog = await client.call('mcpServerStatus/list', { threadId, serverName: 'fisch_live', detail: 'full', limit: 100 });
  const server = catalog.data?.find(row => row.name === 'fisch_live');
  const tool = Array.isArray(server?.tools) ? server.tools.find(t => t.name === 'compose_expression') : server?.tools?.compose_expression;
  if (!tool || canonical(tool.inputSchema) !== canonical(compositionSchema)) throw Error('catalog_unverified');
  const inspected = textValue(await toolCall(client, threadId, 'inspect_expression'));
  if (inspected?.source !== 'fisch-renderer' || !inspected.epoch || !inspected.session) throw Error('renderer_epoch_unverified');
  return { epoch: inspected.epoch, session: inspected.session, catalogHash: hash(canonical(server.tools)), policy: audit.rows[0] };
}
function order(cases, seed) {
  const sorted = [...cases].sort((a, b) => hash(seed + a.id).localeCompare(hash(seed + b.id)));
  return sorted.flatMap((entry, index) => (index % 2 ? ['structured', 'optional'] : ['optional', 'structured']).map(arm => ({ entry, arm })));
}
async function evidence(live, client, threadId, outcome, turn, directory, code, videoStarted) {
  await live.page.waitForTimeout(1500);
  const metrics = await live.page.evaluate(() => window.fischLive.metrics());
  const status = outcome?.receipt?.requestId ? textValue(await toolCall(client, threadId, 'expression_status', { requestId: outcome.receipt.requestId })) : null;
  await live.page.locator('#body').screenshot({ path: join(directory, 'blind', code + '.png') });
  const video = await finishBodyVideo(live.page, directory, code, videoStarted, null, true);
  return { video, status, metrics, modelBodyToolRequests: turn.toolRequests.filter(isBodyMutation).length,
    humanRecognition: null, contextualUtility: null, textQuality: null, interpretation: 'Full actual canvas clip, no audio/camera; admission and sampled output are not recognition or completed animation.' };
}
async function trial(entry, arm, settings) {
  let live, client, stage = 'startup', reserved = false;
  const code = blindCodes(1)[0], startedAt = performance.now(), audit = policyAudit(settings.policy);
  try {
    live = await openLive({ headless: true, assets: false, production: false });
    client = await openModelClient(live, { onRequest: message => audit.receive(message) });
    const started = await client.call('thread/start', { model: settings.model, cwd: settings.workspace });
    const threadId = started.thread?.id; if (!threadId || started.model !== settings.model) throw Error('effective_model_unverified'); client.focus(threadId);
    stage = 'preflight'; const verified = await preflight(client, threadId, audit);
    if (settings.catalog.hash && settings.catalog.hash !== verified.catalogHash) throw Error('catalog_changed_between_arms');
    settings.catalog.hash = verified.catalogHash;
    if (settings.catalog.policy && settings.catalog.policy !== verified.policy.hash) throw Error('effective_policy_changed_between_arms');
    settings.catalog.policy = verified.policy.hash;
    const channel = new ExpressionResponseChannel({ call: (method, params) => client.call(method, params) });
    const token = channel.begin({ threadId, epoch: verified.epoch });
    const videoStarted = await startBodyVideo(live.page);
    stage = 'model'; const modelStart = performance.now();
    const turn = await runChannelTurn(client, threadId, entry.message, {
      ...(arm === 'structured' ? { outputSchema: expressionResponseSchema } : {}),
      beforeStart: () => { reserveModelTurn(settings.budget, `expression-channel:${arm}:${entry.id}`); reserved = true; },
      onStarted: turnId => arm !== 'structured' || channel.bind(token, turnId),
    });
    stage = 'response'; const dispatchAt = performance.now();
    const outcome = arm === 'structured' ? await channel.complete(token, turn) : { dispatch: 'not_requested', reply: turn.messages.at(-1)?.text ?? '', mode: null };
    stage = 'render'; const observed = await evidence(live, client, threadId, outcome, turn, settings.directory, code, videoStarted);
    if (await live.page.locator('video').evaluate(v => !!v.srcObject)) throw Error('unexpected_camera');
    const row = { code, id: entry.id, arm, status: 'recorded', reserved, verified, requestedModel: settings.model, effectiveModel: started.model,
      timing: { ...turn.timing, modelToHostDecisionMs: dispatchAt - modelStart, totalTrialMs: performance.now() - startedAt }, turn, outcome, observed };
    writeFileSync(join(settings.directory, 'private', code + '.reply.txt'), outcome.reply ?? '', { mode: 0o600 });
    return row;
  } catch (error) { return { code, id: entry.id, arm, status: 'failed', stage, reserved, errorCode: /^[a-z_]+$/.test(error.message) ? error.message : 'trial_failed', durationMs: performance.now() - startedAt }; }
  finally { await client?.close(); await live?.close(); }
}
export async function runExpressionChannelTrial({ budget, output, model, seed = 'paired-dev-1', positiveControl = false }) {
  if (process.env.FISCH_RUN_MODEL_TESTS !== '1' || !budget || !output || typeof model !== 'string' || !model) throw Error('explicit_trial_configuration_required');
  const dataset = JSON.parse(readFileSync(new URL('../docs/expression-channel-dev.json', import.meta.url), 'utf8'));
  const cases = positiveControl ? [...dataset.cases, dataset.positiveControl] : dataset.cases;
  const planned = order(cases, seed), ledger = readModelBudget(budget);
  if (ledger.limit - ledger.used < planned.length || Date.now() >= Date.parse(ledger.deadline)) throw Error('trial_budget_or_deadline');
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  const directory = resolve(output, 'channel-' + Date.now() + '-' + randomBytes(4).toString('hex')); mkdirSync(join(directory, 'private'), { recursive: true, mode: 0o700 }); mkdirSync(join(directory, 'blind'), { mode: 0o700 });
  const workspace = join(directory, 'private', 'workspace'); mkdirSync(workspace, { mode: 0o700 });
  const policy = readFileSync(new URL('../integrations/live-instructions.md', import.meta.url), 'utf8'), rows = [], catalog = {};
  const manifest = { mode: 'controlled_development_not_holdout', seed, model, plannedTurns: planned.length, policyHash: hash(policy), schemaHash: hash(canonical(expressionResponseSchema)),
    datasetHash: hash(canonical(dataset)), git: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: liveRoot, encoding: 'utf8' }).trim(), comparison: 'same production policy/catalog/model, optional tools vs structured final response; not transparent Native streaming or isolated data worker', rows };
  for (const { entry, arm } of planned) {
    const row = await trial(entry, arm, { budget, directory, workspace, policy, model, catalog }); rows.push(row); save(join(directory, 'private', row.code + '.json'), row);
    save(join(directory, 'private', 'report.json'), manifest);
    save(join(directory, 'private', 'key.json'), rows.map(r => ({ code: r.code, arm: r.arm, message: cases.find(c => c.id === r.id).message })));
    if (row.status === 'failed' && ['startup', 'preflight'].includes(row.stage)) break;
  }
  const codes = rows.filter(r => r.status === 'recorded').map(r => r.code).sort();
  writeFileSync(join(directory, 'blind', 'review.csv'), 'code,visible_description,transition_notes,clarity_notes\n' + codes.map(c => c + ',,,').join('\n'), { mode: 0o600 });
  save(join(directory, 'summary.json'), { recorded: codes.length, planned: planned.length, humanAcceptance: 'pending', actualModelTurnsReserved: rows.filter(r => r.reserved).length, complete: rows.length === planned.length && rows.every(r => r.status === 'recorded') });
  return { directory, rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = key => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
  runExpressionChannelTrial({ budget: option('--budget'), output: option('--output'), model: option('--model'), seed: option('--seed'), positiveControl: process.argv.includes('--positive-control') })
    .then(result => console.log(JSON.stringify({ directory: result.directory, trials: result.rows.length })))
    .catch(error => { console.error(/^[a-z_]+$/.test(error.message) ? error.message : 'trial_failed'); process.exitCode = 1; });
}
