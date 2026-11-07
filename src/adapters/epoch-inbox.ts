import type { GatewayEvent } from './gateway-client';

export class EpochInbox {
  private epoch?: string;
  private pending: GatewayEvent[] = [];
  private retired = new Set<string>();
  accept(event: GatewayEvent): GatewayEvent[] {
    if (event.kind === 'epoch' || event.kind === 'closed') {
      if (this.epoch && this.epoch !== event.epoch) this.retired.add(this.epoch);
      if (this.retired.size > 8) this.retired.delete(this.retired.values().next().value!);
      this.epoch = event.kind === 'epoch' ? event.epoch : undefined;
      const ready = event.kind === 'epoch' ? this.pending.filter(item => item.epoch === event.epoch) : [];
      this.pending = [];
      return [event, ...ready];
    }
    if (event.epoch === this.epoch || this.retired.has(event.epoch)) return [event];
    if (this.pending.length >= 4) throw Error('bridge_epoch_buffer_limit');
    this.pending.push(event);
    return [];
  }
}
