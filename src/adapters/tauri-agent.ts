import { Channel, invoke } from '@tauri-apps/api/core';
import type { AgentStreamAdapter } from './provider';
import type { Envelope } from '../core/ast/types';
type Event = { epoch: string; id: number; kind: 'content' | 'expression' | 'done'; data: unknown };
export class TauriAgent implements AgentStreamAdapter {
  constructor(private error: (code: string) => void) {}
  start(
    _prompt: string,
    epoch: string,
    content: (text: string) => void,
    expression: (record: Envelope) => void,
    done: () => void,
  ) {
    let stopped = false;
    const onContent = new Channel<Event>(),
      onExpression = new Channel<Event>();
    onContent.onmessage = (e) => {
      if (!stopped && e.epoch === epoch) {
        if (e.kind === 'content') content(String(e.data));
        else done();
      }
      void invoke('ack', { epoch, id: e.id, expression: false }).catch(() => this.error('ipc_ack'));
    };
    onExpression.onmessage = (e) => {
      if (!stopped && e.epoch === epoch) expression(e.data as Envelope);
      void invoke('ack', { epoch, id: e.id, expression: true }).catch(() => this.error('ipc_ack'));
    };
    void invoke('start_demo', { epoch, onContent, onExpression }).catch(() => {
      this.error('provider_transport');
      done();
    });
    return () => {
      stopped = true;
      void invoke('cancel_demo', { epoch }).catch(() => this.error('ipc_cancel'));
    };
  }
}
