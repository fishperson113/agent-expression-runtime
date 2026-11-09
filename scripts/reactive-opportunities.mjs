import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeOpportunityArtifacts } from './reactive-opportunities-report.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselineSha = '354d6428ea29255229a9a24c67332583bc7635bc';
const hash = value => createHash('sha256').update(value).digest('hex');
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 10000000 });
  return result.status === 0 ? result.stdout : null;
}
function configuration(args) {
  let quick = false, output = resolve(root, '.runtime/reactive-opportunities'), report;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--quick') quick = true;
    else if (['--output', '--report'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      const key = args[i], value = resolve(args[++i]);
      if (key === '--output') output = value; else report = value;
    }
    else throw Error('diagnostic_arguments');
  }
  return { quick, output, report };
}

async function provenance(inputs) {
  const sourceSha = git('rev-parse', 'HEAD')?.trim();
  if (!sourceSha) throw Error('diagnostic_git_unavailable');
  const baselineAvailable = git('cat-file', '-e', baselineSha + '^{commit}') !== null;
  const runtime = Object.keys(inputs).map(path => relative(root, resolve(root, path)).replaceAll('\\', '/'))
    .filter(path => path.startsWith('src/')).sort();
  const hashes = [], changedFromBaseline = [], changedFromHead = [];
  for (const path of runtime) {
    const current = await readFile(resolve(root, path));
    hashes.push({ path, sha256: hash(current) });
    for (const [revision, changed] of [[baselineSha, changedFromBaseline], [sourceSha, changedFromHead]]) {
      if (revision === baselineSha && !baselineAvailable) continue;
      const prior = git('show', `${revision}:${path}`);
      if (prior === null || hash(Buffer.from(prior)) !== hash(current)) changed.push(path);
    }
  }
  return { sourceSha, baselineSha, baselineAvailable, runtimeInputSha256: hash(JSON.stringify(hashes)), runtimeInputs: hashes,
    runtimeDirty: changedFromHead.length > 0, changedFromHead, changedFromBaseline,
    sameExecutedSourcesAsBaseline: baselineAvailable ? changedFromBaseline.length === 0 : null };
}

async function main() {
  const options = configuration(process.argv.slice(2));
  const temporary = await mkdtemp(resolve(tmpdir(), 'fisch-opportunities-'));
  const started = performance.now();
  try {
    const outfile = resolve(temporary, 'probe.mjs');
    const bundle = await build({ absWorkingDir: root, entryPoints: ['scripts/reactive-opportunities-probe.ts'],
      bundle: true, platform: 'node', format: 'esm', outfile, metafile: true, logLevel: 'silent' });
    const metadata = await provenance(bundle.metafile.inputs);
    const { runOpportunityMatrix } = await import(pathToFileURL(outfile).href);
    const result = await runOpportunityMatrix(options.quick);
    await mkdir(dirname(options.output), { recursive: true });
    if (options.report) await mkdir(dirname(options.report), { recursive: true });
    await writeOpportunityArtifacts(options.output, { ...metadata, generatedAt: new Date().toISOString(),
      runKind: options.quick ? 'quick virtual diagnostic' : 'full virtual diagnostic', elapsedHostMs: Math.round(performance.now() - started),
      sourceStepMs: 50, mainPollMs: 50, syntheticWallOriginMs: 1800000000000, diagnosticParticles: 64,
      provider: 'in-process fixed diagnostic decision', actualModelCalls: 0, mediaApisUsed: false }, result, options.report);
    console.log(JSON.stringify({ sourceSha: metadata.sourceSha, scenarios: result.rows.length, controls: result.controls.length,
      virtualMinutesPerScenario: result.durationMs / 60000, outputPrefix: options.output, accounting: 'passed' }));
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error('diagnostic_harness_failed:', error?.message ?? 'unknown'); process.exitCode = 1; });
