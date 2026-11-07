import { spawn } from 'node:child_process';
import { terminatePlannerProcess } from './planner-process.mjs';

export class PlannerRpc {
  nextId = 0; pending = new Map(); buffer = ''; closed = false;
  constructor(command, args, directory, notify, failed) {
    this.notify = notify; this.failed = failed;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !key.startsWith('HERDR_') && !['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDECODE'].includes(key)));
    this.child = spawn(command, args, { cwd: directory, env, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    this.child.stdout.setEncoding('utf8'); this.child.stdout.on('data', chunk => this.receive(chunk));
    this.child.stderr.on('data', () => {}); this.child.stdin.on('error', () => {});
    this.child.once('error', () => this.close('planner_process_unavailable'));
    this.child.once('close', () => this.close('planner_process_closed'));
  }
  send(message) { if (!this.closed) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params, timeoutMs = 10000) {
    if (this.closed) return Promise.reject(Error('planner_process_closed'));
    if (this.pending.size >= 8) return Promise.reject(Error('planner_rpc_busy'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId, timer = setTimeout(() => {
        this.pending.delete(id); reject(Error('planner_rpc_timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  receive(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 262144) return this.close('planner_rpc_budget');
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      try { this.dispatch(JSON.parse(line)); } catch { this.close('planner_rpc_invalid'); return; }
    }
  }
  dispatch(message) {
    if (message.id !== undefined && message.method) {
      this.send({ id: message.id, error: { code: -32601, message: 'Planner client does not execute tools.' } }); return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(Error('planner_rpc_error')); else pending.resolve(message.result);
    } else if (message.method) this.notify(message.method, message.params ?? {});
  }
  close(code = 'planner_process_closed') {
    if (this.closed) return; this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error(code)); }
    this.pending.clear(); terminatePlannerProcess(this.child); this.failed(code);
  }
}
