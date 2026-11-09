import type { HandObservation } from './types';

type Entity = HandObservation['entities'][number];
type Track = { id: string; x: number; y: number; at: number };
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Short geometric continuity only; crossing/occlusion cannot establish identity. */
export class HandTracker {
  private tracks: Track[] = [];
  private primary?: string;
  private generation = 0;
  private next = 0;
  private source?: string;
  private previousAt = -Infinity;
  reset() { this.tracks = []; this.primary = undefined; this.generation++; this.source = undefined; this.previousAt = -Infinity; }
  update(value: HandObservation | undefined, at: number): HandObservation | undefined {
    if (!value) { this.reset(); return; }
    const source = `${value.sourceWidth}:${value.sourceHeight}:${value.mirrored}`;
    if (!Number.isFinite(at)) { this.reset(); return; }
    if (source !== this.source || at <= this.previousAt || at - this.previousAt > 300 || ['error', 'unavailable'].includes(value.trackingState)) this.reset();
    this.source = source; this.previousAt = at;
    this.tracks = this.tracks.filter(track => at - track.at <= 300);
    const entities = structuredClone(value.entities).sort((a, b) => a.landmarks[0].x - b.landmarks[0].x || a.landmarks[0].y - b.landmarks[0].y || a.detectionId - b.detectionId);
    const matches = entities.map(entity => this.match(entity));
    const ambiguous = matches.includes('ambiguous') || matches.some((id, i) => id !== undefined && matches.indexOf(id) !== i);
    if (ambiguous) { this.tracks = []; this.primary = undefined; }
    const current = entities.map((entity, index) => this.assign(entity, ambiguous ? undefined : matches[index], at));
    const visible = new Set(current.map(entity => entity.trackId!));
    const previous = this.tracks.find(track => track.id === this.primary);
    if (!this.primary || (!visible.has(this.primary) && (!previous || at - previous.at >= 250))) this.primary = current[0]?.trackId;
    this.tracks = this.tracks.filter(track => visible.has(track.id) || at - track.at <= 300)
      .sort((a, b) => Number(visible.has(b.id)) - Number(visible.has(a.id)) || Number(b.id === this.primary) - Number(a.id === this.primary) || b.at - a.at).slice(0, 4);
    return { ...structuredClone(value), entities: current, primaryTrackId: this.primary && visible.has(this.primary) ? this.primary : null };
  }
  private match(entity: Entity): string | undefined {
    const candidates = this.tracks.map(track => ({ id: track.id, distance: distance(track, entity.landmarks[0]) }))
      .filter(candidate => candidate.distance <= 0.18).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    if (candidates.length > 1 && candidates[1].distance - candidates[0].distance <= 0.04) return 'ambiguous';
    return candidates[0]?.id;
  }
  private assign(entity: Entity, matched: string | undefined, at: number): Entity {
    const id = matched ?? `hand_${this.generation}_${++this.next}`;
    this.tracks = this.tracks.filter(track => track.id !== id);
    this.tracks.push({ id, x: entity.landmarks[0].x, y: entity.landmarks[0].y, at });
    return { ...entity, trackId: id };
  }
}
