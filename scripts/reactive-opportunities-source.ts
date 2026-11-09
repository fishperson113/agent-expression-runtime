import { FaceObservations } from '../src/live/observation';
import type { Observation } from '../src/core/live/types';
import type { SessionEvent } from '../src/core/live/reactive-session-types';

export type Scenario = { rate: number; latency: number; seed: number; mode: 'fresh' | 'source-loss' | 'user-busy' };
export const stepMs = 50;
export const wallOriginMs = 1_800_000_000_000;

export class OpportunitySource {
  private observations = new FaceObservations('qa_synthetic');
  private landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  private matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  private nextChange: number;
  private random: number;
  private score = 0;
  private sequence = 0;
  rawChanges = 0;
  constructor(private scenario: Scenario) {
    this.nextChange = scenario.rate ? 1000 / scenario.rate : Infinity;
    this.random = scenario.seed >>> 0;
  }
  frame(at: number): { snapshot: Observation; events: SessionEvent[] } {
    while (at >= this.nextChange) {
      this.score = 1 - this.score;
      this.rawChanges++;
      this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0;
      const factor = this.scenario.seed ? 0.8 + 0.4 * this.random / 4294967296 : 1;
      this.nextChange += 1000 / this.scenario.rate * factor;
    }
    this.landmarks[1].x = 0.5 + 0.2 * Math.sin(at / 1000);
    const wall = wallOriginMs + at;
    const unavailable = this.scenario.mode === 'source-loss' && at % 20000 >= 10000 && at % 20000 < 12000;
    if (unavailable) {
      this.observations.status('stopped', wall);
      return { snapshot: this.observations.snapshot, events: [] };
    }
    const events = this.observations.update({ landmarks: this.landmarks, matrix: this.matrix,
      scores: { mouthSmileLeft: this.score, mouthSmileRight: this.score }, durationMs: 0, delegate: 'synthetic' }, wall);
    return { snapshot: this.observations.snapshot, events: events.map(event => ({ ...event, seq: ++this.sequence })) };
  }
}
