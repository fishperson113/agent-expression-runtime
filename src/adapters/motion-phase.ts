/** Renderer-owned phase: changing speed never reinterprets elapsed uptime. */
export class MotionPhase {
  angle = 0;
  private previous?: number;
  advance(now: number, speed: number) {
    const dt =
      this.previous === undefined ? 0 : Math.max(0, Math.min(100, now - this.previous)) / 1000;
    this.previous = now;
    this.angle = (this.angle + dt * speed * 0.35) % (Math.PI * 2);
    return this.angle;
  }
}
