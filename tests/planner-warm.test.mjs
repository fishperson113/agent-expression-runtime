import { expect, it } from 'vitest';
import { WarmCodexPlanner } from '../integrations/planner-codex.mjs';
import { PlannerRpc } from '../integrations/planner-rpc.mjs';
import { tmpdir } from 'node:os';

it('reuses one Codex process with fresh ephemeral threads, no MCP tools and structured output', async () => {
  let notify, starts = 0, threads = 0; const calls = [];
  const client = new WarmCodexPlanner({ backend: 'codex' }, (_, args, __, onEvent) => {
    starts++; notify = onEvent; expect(args).toContain('app-server'); expect(args).toContain('hooks');
    return { closed: false, send() {}, close() { this.closed = true; }, async request(method, params) {
      calls.push({ method, params });
      if (method === 'config/read') return { config: { mcp_servers: { external: {} } } };
      if (method === 'thread/start') return { thread: { id: 'thread-' + ++threads } };
      if (method === 'turn/start') {
        queueMicrotask(() => {
          notify('item/completed', { threadId: params.threadId, item: { type: 'agentMessage', text: '{"body":{}}' } });
          notify('turn/completed', { threadId: params.threadId, turn: { status: 'completed' } });
        });
        return { turn: { id: 'turn-' + threads } };
      }
      return {};
    } };
  });
  try {
    for (let i = 0; i < 2; i++) expect(await client.run({ activity: 'idle' }, new AbortController().signal)).toEqual({ body: {} });
    expect(starts).toBe(1); expect(threads).toBe(2);
    const thread = calls.find(call => call.method === 'thread/start').params;
    expect(thread).toMatchObject({ ephemeral: true, approvalPolicy: 'never', config: { mcp_servers: { external: { enabled: false } } } });
    expect(calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(2);
    expect(calls.find(call => call.method === 'turn/start').params.sandboxPolicy).toEqual({ type: 'readOnly' });
  } finally { client.close(); }
});
it('exchanges bounded RPC records with a real background process', async () => {
  const script = 'let b="";process.stdin.on("data",c=>{b+=c;let i;while((i=b.indexOf("\\n"))>=0){const x=JSON.parse(b.slice(0,i));b=b.slice(i+1);console.log(JSON.stringify({id:x.id,result:{method:x.method}}));}});';
  const rpc = new PlannerRpc(process.execPath, ['-e', script], tmpdir(), () => {}, () => {});
  try { expect(await rpc.request('probe', {})).toEqual({ method: 'probe' }); }
  finally { rpc.close(); }
});
