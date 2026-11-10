import type { Compiled, ProgramIR, StateIR } from '../runtime/ir';
type TimedIR = ProgramIR | StateIR;
type Status = 'applied' | 'completed' | 'cancelled';

// Configuration leases and scheduler programs share one external receipt.
export class ExpressionLifecycle {
  private held?: { ir: TimedIR; until: number; programDone: boolean };
  private cancelled = new WeakSet<Compiled>();
  constructor(private emit: (status: Status, ir: TimedIR) => void) {}
  configuration(ir: TimedIR, until: number) {
    this.cancel();
    this.held = { ir, until, programDone: false };
  }
  feedback(status: Status, ir: TimedIR) {
    if (this.cancelled.has(ir)) return;
    if (this.held?.ir === ir) {
      if (status === 'completed') { this.held.programDone = true; return; }
      if (status === 'cancelled') this.held = undefined;
    }
    this.emit(status, ir);
  }
  tick(now: number) {
    const held = this.held;
    if (held?.programDone && now > held.until) {
      this.held = undefined;
      this.emit('completed', held.ir);
    }
  }
  cancel() {
    if (!this.held) return;
    const { ir } = this.held; this.held = undefined;
    this.cancelled.add(ir); this.emit('cancelled', ir);
  }
}
