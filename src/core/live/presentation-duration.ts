import type { Compiled } from '../runtime/ir';

export function presentationDuration(program: Compiled) {
  if (program.kind === 'define') return 0;
  let duration = program.duration;
  if (program.kind === 'program') for (const op of program.ops) {
    if (op.property !== 'shape' || typeof op.value !== 'object') continue;
    const trajectory = Math.max(0, ...op.value.parts.map(part => part.trajectory?.keyframes.at(-1)?.atMs ?? 0));
    if (trajectory > 0) duration = Math.max(duration, op.at + op.duration + trajectory + 100);
  }
  return duration;
}
