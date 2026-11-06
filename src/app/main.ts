import '../ui/style.css';
import { CompilerHost } from './compiler-host';
import { RenderHost } from './render-host';
import { FakeAgent, capabilityPrompt, type AgentStreamAdapter } from '../adapters/provider';
import { capability } from '../primitives/registry';
import type { Envelope } from '../core/ast/types';
import type { Compiled } from '../core/runtime/ir';
import { TauriAgent } from '../adapters/tauri-agent';
import { GatewayConnection } from '../adapters/gateway-client';
import { HttpGatewayConnection } from '../adapters/http-gateway-client';
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<header><a class="brand" href="/">aer<span> / </span>expression runtime</a><span class="badge">LOCAL SANDBOX · v0.1</span></header>
<main><section class="intro"><div><p class="eyebrow">A BODY FOR YOUR AGENT</p><h1>Presence, in motion.</h1><p>Declarative expression. Independent content. One particle body.</p></div><div class="session"><span class="dot"></span><span id="session">Idle · procedural presence</span></div></section>
<div class="workspace"><section class="stage panel" aria-label="Particle body"><canvas id="body" aria-label="Animated particle visualization"></canvas><div class="stage-top"><span class="badge">BODY / 01</span><span id="mode">Initializing renderer…</span></div><div class="stage-bottom"><div><p class="eyebrow">COMPILED INTENT</p><strong id="shape">sphere / orbit</strong></div><span>Stable particle IDs · seed 42</span></div></section>
<section class="conversation panel"><div class="panel-head"><h2>Agent stream</h2><span class="badge">SCRIPTED DEMO</span></div><div id="messages" role="log" aria-label="Conversation"><p class="muted">Start a turn to watch text and expression arrive independently. This demo uses a scripted adapter, with no model or API costs.</p></div><form id="prompt-form"><label for="prompt">Message</label><textarea id="prompt" rows="2" maxlength="4000">Show me what this body can do.</textarea><div class="actions"><button type="button" id="cancel" class="secondary" disabled>Cancel turn</button><button type="submit" id="send">Start turn ↗</button></div></form></section></div>
<section class="toolbar panel"><label class="toggle"><input type="checkbox" id="expressions" checked> Expressions</label><label class="toggle"><input type="checkbox" id="motion"> Reduced motion</label><label class="toggle"><input type="checkbox" id="stats-toggle" checked> Telemetry</label><label>Particles <select id="quality"><option value="10000">10,000</option><option value="5000">5,000</option><option value="2000">2,000</option></select></label><span class="muted">Expression ≠ emotion</span></section>
<section id="telemetry" class="metrics"><div class="panel"><span>FRAME INTERVAL P95</span><strong id="frame">—</strong><small>Rolling 120 samples · not certification</small></div><div class="panel"><span>COMPILE MAILBOX</span><strong id="queue">0 / 4</strong><small>Overflow is dropped, never awaited</small></div><div class="panel"><span>COMPILED / DIAGNOSTICS</span><strong id="counts">0 / 0</strong><small id="diagnostic">No diagnostics</small></div><div class="panel"><span>CURRENT EPOCH</span><strong id="epoch">idle</strong><small>Cancel invalidates late results</small></div></section>
<section class="inspector panel"><div class="panel-head"><div><p class="eyebrow">EXPRESSION INSPECTOR</p><h2>Compose a program</h2></div><button id="capability" class="secondary">Capabilities</button></div><p class="muted">JSON AST only. No arbitrary code, shaders, network access or emotion mapping.</p><label for="program">Program body</label><textarea id="program" rows="9" spellcheck="false"></textarea><div class="actions"><button id="apply">Apply program</button><label class="toggle"><input type="checkbox" id="record"> Opt in to payload replay capture</label><button id="replay" class="secondary">Replay capture</button><button id="export" class="secondary">Export capture</button></div><p id="feedback" role="status"></p><pre id="manifest" hidden></pre></section>
<footer>Agent Expression Runtime / POC <span>Provider integration and acceptance benchmarks remain open.</span></footer></main>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const desktop = '__TAURI_INTERNALS__' in window;
const requestedSeed = Number(new URLSearchParams(location.search).get('seed') ?? 42);
const bodySeed =
  Number.isInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 0xffffffff
    ? requestedSeed
    : 42;
document.querySelector('.stage-bottom > span')!.textContent =
  `Stable particle IDs / seed ${bodySeed}`;
let gateway: GatewayConnection | HttpGatewayConnection | undefined = desktop
  ? new GatewayConnection()
  : undefined;
const externalJobs = new Map<string, number>();
document
  .querySelector('.intro')!
  .insertAdjacentHTML(
    'afterend',
    `<section class="gateway panel"><div><p class="eyebrow">EXTERNAL AGENT / DEFAULT MODE</p><h2>Connect your agent. Keep your model.</h2><p class="muted" id="gateway-status">${desktop ? 'Starting loopback gateway…' : 'Connect a loopback gateway to drive this browser body from an external agent; the local scripted demo also remains available.'}</p></div><div class="actions"><button id="pair" class="secondary" ${desktop ? '' : 'disabled'}>Show pairing details</button><button id="disconnect" class="secondary" ${desktop ? '' : 'disabled'}>Release controller</button></div><pre id="pairing" hidden></pre></section>`,
  );
if (!desktop) {
  document
    .querySelector('.gateway')!
    .insertAdjacentHTML(
      'beforeend',
      `<div class="actions"><label>Gateway URL<input id="browser-base" value="http://127.0.0.1:"></label><label>Pairing token<input id="browser-token" type="password" autocomplete="off"></label><button id="browser-connect">Connect browser renderer</button></div>`,
    );
  $('browser-connect').onclick = () => {
    try {
      const connection = new HttpGatewayConnection(
        $<HTMLInputElement>('browser-base').value,
        $<HTMLInputElement>('browser-token').value,
      );
      $<HTMLInputElement>('browser-token').value = '';
      connectGateway(connection);
      $<HTMLButtonElement>('disconnect').disabled = false;
    } catch {
      diagnostic('gateway_configuration');
    }
  };
}
let localMode = false;
let externalController = false;
let epoch = 'idle',
  turn = 0,
  seq = 0,
  compiledRecords = 0,
  errors = 0,
  enabled = true,
  cancel: (() => void) | undefined;
let replayTimers: ReturnType<typeof setTimeout>[] = [];
const capture: { at: number; ir: Compiled }[] = [];
let captureStart = 0;
const diagnostic = (code: string) => {
  if (code === 'render_worker_crash' && externalController) void gateway?.revoke();
  errors++;
  $('counts').textContent = `${compiledRecords} / ${errors}`;
  $('diagnostic').textContent = code;
  $('feedback').textContent = `Expression diagnostic: ${code}. Content transport is separate.`;
};
const render = new RenderHost(
  $<HTMLCanvasElement>('body'),
  diagnostic,
  (s) => {
    $('frame').textContent = `${s.frameP95.toFixed(1)} ms`;
    $('mode').textContent = render.mode;
    $<HTMLSelectElement>('quality').value = String(s.particles);
  },
  (e) => {
    void gateway?.feedback(e.epoch, e.seq, e.status);
  },
  bodySeed,
);
const compiler = new CompilerHost(
  (ir, context) => {
    if (ir.epoch !== epoch) {
      compiler.settleDefinition(ir, false);
      diagnostic('stale_epoch');
      if (context) void gateway?.complete(context, 'rejected', 'stale_epoch');
      return;
    }
    compiledRecords++;
    $('counts').textContent = `${compiledRecords} / ${errors}`;
    if (context) {
      const at = externalJobs.get(context);
      externalJobs.delete(context);
      if (at === undefined || performance.now() - at > 450) {
        compiler.settleDefinition(ir, false);
        void gateway?.complete(context, 'rejected', 'admission_timeout');
        return;
      }
      if (!enabled) {
        compiler.settleDefinition(ir, false);
        void gateway?.complete(context, 'rejected', 'expressions_disabled');
        return;
      }
      void render.apply(ir, at + 450).then((status) => {
        if (status === 'pending') return;
        compiler.settleDefinition(ir, ['accepted', 'state', 'defined'].includes(status));
        return gateway?.complete(
          context,
          ['accepted', 'state', 'defined'].includes(status)
            ? 'accepted'
            : status === 'cancelled'
              ? 'cancelled'
              : 'rejected',
          ['accepted', 'state', 'defined'].includes(status) ? undefined : status,
        );
      });
    } else if (enabled)
      void render
        .apply(ir)
        .then((status) =>
          compiler.settleDefinition(ir, ['accepted', 'state', 'defined'].includes(status)),
        );
    else compiler.settleDefinition(ir, false);
    if (ir.kind === 'program') {
      $('shape').textContent =
        ir.ops
          .filter((o) => o.property === 'shape' || o.property === 'flow')
          .map((o) => o.value)
          .join(' / ') || 'style transition';
    }
    if ($<HTMLInputElement>('record').checked && capture.length < 1000)
      capture.push({ at: performance.now() - captureStart, ir });
    $('queue').textContent = `${compiler.depth} / 4`;
  },
  (code, context, path) => {
    diagnostic(code);
    if ((code === 'compiler_restarted' || code === 'compiler_unavailable') && externalController)
      void gateway?.revoke();
    if (context) {
      externalJobs.delete(context);
      void gateway?.complete(context, 'rejected', code, path);
    }
  },
  bodySeed,
);
function connectGateway(connection: GatewayConnection | HttpGatewayConnection) {
  gateway = connection;
  void connection
    .subscribe((event) => {
      if (event.kind === 'closed') {
        externalController = false;
        compiler.resetSession();
        if (!localMode) {
          epoch = event.epoch;
          compiler.setEpoch(epoch);
          render.setEpoch(epoch);
          externalJobs.clear();
          $('session').textContent = 'Controller released';
        }
        return;
      }
      if (event.kind === 'epoch') {
        externalController = true;
        if (event.id) compiler.resetSession();
        localMode = false;
        cancel?.();
        cancel = undefined;
        epoch = event.epoch;
        seq = 0;
        compiler.setEpoch(epoch);
        render.setEpoch(epoch);
        externalJobs.clear();
        $('epoch').textContent = epoch.slice(0, 12);
        $('session').textContent = 'External agent connected';
        $('gateway-status').textContent =
          'Controller connected · prompt and content stay with your agent';
      } else {
        if (event.epoch !== epoch) {
          void connection.complete(event.id, 'rejected', 'stale_epoch');
          return;
        }
        const at = performance.now();
        externalJobs.set(event.id, at);
        compiler.submit(event.record, at, event.id);
      }
    })
    .then(async () => {
      const pairing = await connection.pairing();
      $('gateway-status').textContent =
        `Listening on ${pairing.baseUrl} · token required · no model API calls`;
    })
    .catch(() => diagnostic('connection_subscription'));
}
if (gateway) connectGateway(gateway);
$('pair').onclick = async () => {
  const p = $('pairing');
  if (!p.hidden) {
    p.hidden = true;
    p.textContent = '';
    return;
  }
  if (gateway) {
    const info = await gateway.pairing();
    p.textContent = `Base URL: ${info.baseUrl}\nPairing token (host credential; never put in model prompt):\n${info.token}`;
    p.hidden = false;
  }
};
$('disconnect').onclick = () => {
  void gateway?.revoke();
  $('gateway-status').textContent = 'Controller released. A new host can create a session.';
  $('pairing').hidden = true;
  $('pairing').textContent = '';
};
function nextEpoch() {
  if (externalController) {
    $('feedback').textContent =
      'An external controller owns this body. Release it explicitly before starting a local demo.';
    return false;
  }
  localMode = true;
  cancel?.();
  cancel = undefined;
  for (const timer of replayTimers) clearTimeout(timer);
  replayTimers = [];
  epoch = `turn-${++turn}`;
  seq = 0;
  render.setEpoch(epoch);
  compiler.setEpoch(epoch);
  $('epoch').textContent = epoch;
  $<HTMLButtonElement>('cancel').disabled = true;
  $('session').textContent = 'Idle · procedural presence';
  return true;
}
const adapter: AgentStreamAdapter =
  '__TAURI_INTERNALS__' in window ? new TauriAgent(diagnostic) : new FakeAgent();
$('prompt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!nextEpoch()) return;
  const prompt = $<HTMLTextAreaElement>('prompt').value.trim();
  if (!prompt) return;
  const messages = $('messages');
  messages.replaceChildren();
  const question = document.createElement('p');
  question.className = 'question';
  question.textContent = prompt;
  messages.append(question);
  const answer = document.createElement('p');
  answer.className = 'answer';
  messages.append(answer);
  $('session').textContent = 'Streaming · content + expression';
  $<HTMLButtonElement>('cancel').disabled = false;
  const thisEpoch = epoch;
  cancel = adapter.start(
    prompt,
    epoch,
    (delta) => {
      if (epoch === thisEpoch) {
        answer.append(document.createTextNode(delta));
        messages.scrollTop = messages.scrollHeight;
      }
    },
    (record) => {
      if (epoch !== thisEpoch || !enabled) return;
      seq = Math.max(seq, record.seq);
      compiler.submit(record, performance.now());
    },
    () => {
      if (epoch === thisEpoch) {
        $('session').textContent = 'Complete · body continues';
        $<HTMLButtonElement>('cancel').disabled = true;
      }
    },
  );
});
$('cancel').onclick = () => {
  if (!nextEpoch()) return;
  $('feedback').textContent = 'Turn cancelled. Late expressions are discarded.';
};
$<HTMLInputElement>('expressions').onchange = (e) => {
  enabled = (e.target as HTMLInputElement).checked;
  if (!enabled) {
    compiler.setEpoch(epoch);
    render.setEpoch(epoch);
  }
};
const media = matchMedia('(prefers-reduced-motion: reduce)');
$<HTMLInputElement>('motion').checked = media.matches;
render.setMotion(media.matches);
media.onchange = (e) => {
  $<HTMLInputElement>('motion').checked = e.matches;
  render.setMotion(e.matches);
};
$<HTMLInputElement>('motion').onchange = (e) =>
  render.setMotion((e.target as HTMLInputElement).checked);
$<HTMLInputElement>('stats-toggle').onchange = (e) =>
  ($('telemetry').hidden = !(e.target as HTMLInputElement).checked);
$<HTMLSelectElement>('quality').onchange = (e) =>
  render.setQuality(Number((e.target as HTMLSelectElement).value));
$<HTMLTextAreaElement>('program').value = JSON.stringify(
  {
    type: 'parallel',
    children: [
      { type: 'morph', target: 'wall', durationMs: 1200 },
      { type: 'flow', field: 'orbit', strength: 0.45, durationMs: 2000 },
      { type: 'style', color: '#b1a0ff', brightness: 0.8, durationMs: 1000 },
    ],
  },
  null,
  2,
);
$('apply').onclick = () => {
  if (externalController) {
    $('feedback').textContent =
      'Release the external controller before applying a local inspector program.';
    return;
  }
  try {
    const body = JSON.parse($<HTMLTextAreaElement>('program').value);
    const record: Envelope = {
      v: 1,
      epoch,
      seq: ++seq,
      kind: 'program',
      track: 'body',
      policy: 'replace',
      body,
    };
    compiler.submit(record, performance.now());
    $('feedback').textContent = 'Submitted for validation.';
  } catch {
    diagnostic('invalid_json');
  }
};
$('capability').onclick = () => {
  const p = $('manifest');
  p.hidden = !p.hidden;
  p.textContent = JSON.stringify(capability, null, 2);
};
$<HTMLInputElement>('record').onchange = (e) => {
  if ((e.target as HTMLInputElement).checked) {
    capture.length = 0;
    captureStart = performance.now();
  }
};
$('replay').onclick = () => {
  if (!capture.length) {
    $('feedback').textContent = 'Capture a turn first using the opt-in checkbox.';
    return;
  }
  if (!nextEpoch()) return;
  const replayEpoch = epoch;
  capture.forEach(({ at, ir }, i) =>
    replayTimers.push(
      setTimeout(() => {
        if (epoch !== replayEpoch) return;
        render.apply({
          ...ir,
          epoch: replayEpoch,
          seq: i,
          ...('receivedAt' in ir ? { receivedAt: performance.now() } : {}),
        });
      }, at),
    ),
  );
  $('feedback').textContent =
    `Replaying ${capture.length} normalized records with original relative timing and seeds.`;
};
$('export').onclick = () => {
  if (!capture.length) {
    $('feedback').textContent = 'No payload capture available.';
    return;
  }
  const blob = new Blob(
    [JSON.stringify({ v: 1, capability: capability.revision, records: capture }, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'expression-replay.json';
  a.click();
  URL.revokeObjectURL(url);
};
window.addEventListener('beforeunload', () => {
  cancel?.();
  compiler.dispose();
  render.dispose();
  replayTimers.forEach(clearTimeout);
});
void capabilityPrompt;
