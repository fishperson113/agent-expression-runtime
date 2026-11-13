import { capability } from '../../primitives/registry';
import type { Part } from '../geometry/types';
import { validateSculpture } from '../geometry/validate';

export function appendScene(record: any, currentParts?: readonly Part[]) {
  if (!currentParts?.length) throw Error('scene_append_unavailable');
  const program = record.body.program;
  if (program?.type !== 'parallel' || !Array.isArray(program.children) || program.children.length > 3)
    throw Error('scene_append_program');
  const shapes = program.children.filter((node: any) => node?.type === 'assemble');
  if (shapes.length !== 1 || program.children.some((node: any) => !['assemble', 'style', 'flow'].includes(node?.type)))
    throw Error('scene_append_program');
  const authored = validateSculpture({ parts: shapes[0].parts }, '$.body.program.parts').parts;
  const remaining = Math.max(0, capability.assembly.parts - currentParts.length);
  if (authored.length > remaining) throw Error(`scene_append_part_limit_remaining_${remaining}`);
  const ids = new Set(currentParts.map(part => part.id));
  if (authored.some(part => ids.has(part.id))) throw Error('scene_append_collision');
  const groups = new Set(currentParts.flatMap(part => part.trajectory ? [part.trajectory.group] : []));
  if (authored.some(part => part.trajectory && groups.has(part.trajectory.group))) throw Error('scene_append_track_collision');
  const parts = validateSculpture({ parts: [...currentParts, ...authored] }, '$.body.program.parts').parts;
  const expanded = structuredClone(record);
  expanded.body.program.children.find((node: any) => node.type === 'assemble').parts = parts;
  const bytes = new TextEncoder().encode(JSON.stringify(expanded)).length;
  if (bytes > 32768) throw Error('record_too_large');
  return expanded;
}
