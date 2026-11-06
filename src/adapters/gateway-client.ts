import { Channel, invoke } from '@tauri-apps/api/core';
export type GatewayEvent = {
  kind: 'epoch' | 'closed' | 'expression';
  id: string;
  epoch: string;
  record: unknown;
};
export class GatewayConnection {
  async subscribe(receive: (event: GatewayEvent) => void) {
    const onEvent = new Channel<GatewayEvent>();
    onEvent.onmessage = (e) => {
      receive(e);
      if (e.kind !== 'expression') void invoke('gateway_control_ack', { epoch: e.epoch });
    };
    await invoke('gateway_subscribe', { onEvent });
  }
  pairing() {
    return invoke<{ baseUrl: string; token: string; protocolVersion: number }>('gateway_pairing');
  }
  complete(id: string, status: string, code?: string, path?: string) {
    return invoke('gateway_complete', { id, status, code: code ?? null, path: path ?? null });
  }
  feedback(epoch: string, seq: number, status: string) {
    return invoke('gateway_feedback', { epoch, seq, status });
  }
  revoke() {
    return invoke('gateway_revoke');
  }
}
