import { capability } from '../../primitives/registry';
import type { Part } from '../geometry/types';
import { validateSculpture } from '../geometry/validate';

export function appendScene(record: any, currentParts?: readonly Part[]) {
  if (!currentParts?.length) throw Error('scene_append_unavailable');
  const removals: string[] = record.body.configuration.sceneRemove ?? [];
  const remove = new Set(removals);
  if (removals.some(id => !currentParts.some(part => part.id === id))) throw Error('scene_remove_unknown_id');
  const retained = currentParts.filter(part => !remove.has(part.id));
  const program = record.body.program;
  if (program?.type !== 'parallel' || !Array.isArray(program.children) || program.children.length > 3)
    throw Error('scene_append_program');
  const shapes = program.children.filter((node: any) => node?.type === 'assemble' || (remove.size && node?.type === 'wait'));
  if (shapes.length !== 1 || program.children.some((node: any) => !['assemble', 'style', 'flow', ...(remove.size ? ['wait'] : [])].includes(node?.type)))
    throw Error('scene_append_program');
  const authored = shapes[0].type === 'wait' ? [] : validateSculpture({ parts: shapes[0].parts }, '$.body.program.parts').parts;
  if (!retained.length && !authored.length) throw Error('scene_remove_empty');
  const remaining = Math.max(0, capability.assembly.parts - retained.length);
  if (authored.length > remaining) throw Error(`scene_append_part_limit_remaining_${remaining}`);
  const ids = new Set(retained.map(part => part.id));
  if (authored.some(part => ids.has(part.id))) throw Error('scene_append_collision');
  const groups = new Set(retained.flatMap(part => part.trajectory ? [part.trajectory.group] : []));
  if (authored.some(part => part.trajectory && groups.has(part.trajectory.group))) throw Error('scene_append_track_collision');
  const parts = validateSculpture({ parts: [...retained, ...authored] }, '$.body.program.parts').parts;
  const expanded = structuredClone(record);
  const index = program.children.indexOf(shapes[0]);
  expanded.body.program.children[index] = shapes[0].type === 'wait'
    ? { type: 'assemble', parts, durationMs: shapes[0].durationMs } : { ...expanded.body.program.children[index], parts };
  const bytes = new TextEncoder().encode(JSON.stringify(expanded)).length;
  if (bytes > 32768) throw Error('record_too_large');
  return expanded;
}
