import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plannerCommand } from './planner-process.mjs';
import { PlannerRpc } from './planner-rpc.mjs';
import { planSchema, plannerInstructions } from './expression-plan.mjs';

export class WarmCodexPlanner {
  starts = 0; requests = 0; jobs = new Map(); closed = false;
  constructor(config, rpcFactory = (...args) => new PlannerRpc(...args)) { this.config = config; this.rpcFactory = rpcFactory; }
  async prepare() {
    if (this.closed) throw Error('planner_closed');
    if (this.rpc && !this.rpc.closed) return;
    this.directory ??= mkdtempSync(join(tmpdir(), 'fisch-codex-'));
    const resolved = plannerCommand({ ...this.config, model: undefined }, '', this.directory);
    const prefix = resolved.args.slice(0, resolved.args.indexOf('exec'));
    const args = [...prefix, 'app-server', '--stdio', '-c', 'approval_policy="never"', '-c', 'sandbox_mode="read-only"',
      '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"', '-c', 'features.skip_host_skill_discovery=true',
      ...['shell_tool', 'apps', 'plugins', 'hooks', 'multi_agent', 'computer_use', 'browser_use', 'image_generation', 'view_image']
        .flatMap(feature => ['--disable', feature])];
    this.rpc = this.rpcFactory(resolved.command, args, this.directory,
      (method, params) => this.event(method, params), code => { for (const job of this.jobs.values()) job.reject(Error(code)); });
    this.starts++;
    await this.rpc.request('initialize', { clientInfo: { name: 'fisch_planner', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.rpc.send({ method: 'initialized' });
    const { config } = await this.rpc.request('config/read', { includeLayers: false });
    this.threadConfig = { model_reasoning_effort: 'low', mcp_servers:
      Object.fromEntries(Object.keys(config?.mcp_servers ?? {}).map(name => [name, { enabled: false }])) };
  }
  event(method, params) {
    const job = this.jobs.get(params.threadId); if (!job) return;
    if (method === 'turn/started') job.turnId = params.turn.id;
    if (method === 'item/completed' && params.item?.type === 'agentMessage') job.text = params.item.text;
    if (method === 'turn/completed') {
      try {
        if (params.turn.status !== 'completed') throw Error('planner_turn_failed');
        job.resolve(JSON.parse(job.text));
      } catch { job.reject(Error('planner_turn_failed')); }
    }
  }
  async run(context, signal) {
    if (this.rpc?.closed) this.starting = null;
    await (this.starting ??= this.prepare().catch(error => { this.rpc?.close(); this.starting = null; throw error; }));
    if (this.closed || signal.aborted) throw Error('planner_aborted');
    const { thread } = await this.rpc.request('thread/start', { ephemeral: true, cwd: this.directory, sandbox: 'read-only',
      approvalPolicy: 'never', baseInstructions: plannerInstructions, config: this.threadConfig,
      ...(this.config.model ? { model: this.config.model } : {}), dynamicTools: [], environments: [] });
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {});
    const job = { resolve, reject, text: '', turnId: null }; this.jobs.set(thread.id, job); this.requests++;
    const abort = () => {
      if (job.turnId) void this.rpc.request('turn/interrupt', { threadId: thread.id, turnId: job.turnId }).catch(() => {});
      reject(Error('planner_aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const result = await this.rpc.request('turn/start', { threadId: thread.id, effort: 'low', summary: 'none',
        input: [{ type: 'text', text: JSON.stringify(context) }], outputSchema: planSchema });
      job.turnId = result.turn.id; if (signal.aborted) abort();
      return await promise;
    } finally {
      signal.removeEventListener('abort', abort); this.jobs.delete(thread.id);
      void this.rpc.request('thread/unsubscribe', { threadId: thread.id }).catch(() => {});
    }
  }
  close() {
    this.closed = true; this.rpc?.close();
    if (this.directory) { try { rmdirSync(this.directory); } catch {} }
  }
}
export function warmCodexPlanner(config) {
  const client = new WarmCodexPlanner(config), plan = (context, signal) => client.run(context, signal);
  plan.close = () => client.close(); plan.transport = () => ({ type: 'persistent-codex', starts: client.starts, requests: client.requests });
  return plan;
}
