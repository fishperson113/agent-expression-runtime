import * as THREE from 'three';
export type ProjectedPart = { id: string; particles: number; visibleParticles: number; centroid: { x: number; y: number } | null; bounds: { min: { x: number; y: number }; max: { x: number; y: number } } | null };
/** Projects submitted particle centers, not DSL targets or point-sprite pixel extents. */
export function projectParticleParts(positions: Float32Array, count: number, groups: Uint8Array,
  ids: readonly string[], clipFromModel: THREE.Matrix4): ProjectedPart[] {
  const sums = ids.map(id => ({ id, particles: 0, visibleParticles: 0, x: 0, y: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }));
  const v = new THREE.Vector4();
  for (let i = 0; i < Math.min(count, Math.floor(positions.length / 3), groups.length); i++) {
    const part = sums[groups[i]]; if (!part) continue;
    part.particles++;
    v.set(positions[i*3], positions[i*3+1], positions[i*3+2], 1).applyMatrix4(clipFromModel);
    if (![v.x,v.y,v.z,v.w].every(Number.isFinite) || v.w <= 0 || Math.abs(v.x)>v.w || Math.abs(v.y)>v.w || Math.abs(v.z)>v.w) continue;
    const x = (v.x / v.w + 1) / 2, y = (1 - v.y / v.w) / 2;
    part.visibleParticles++; part.x += x; part.y += y;
    part.minX=Math.min(part.minX,x);part.minY=Math.min(part.minY,y);part.maxX=Math.max(part.maxX,x);part.maxY=Math.max(part.maxY,y);
  }
  return sums.map(p => ({ id:p.id, particles:p.particles, visibleParticles:p.visibleParticles,
    centroid:p.visibleParticles ? {x:p.x/p.visibleParticles,y:p.y/p.visibleParticles} : null,
    bounds:p.visibleParticles ? {min:{x:p.minX,y:p.minY},max:{x:p.maxX,y:p.maxY}} : null }));
}
