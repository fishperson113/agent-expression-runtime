import { appendScene } from './scene-extension';
import type { Part } from '../geometry/types';
import { Compiler } from '../compiler/compiler';
import { strictObject } from './observation';
import { validateConfiguration } from './control-validation';
import type { LiveCompiled, LiveConfiguration } from './control-types';

export class LiveCompiler {
  constructor(readonly compiler = new Compiler()) {}
  compile(record: any, receivedAt: number, currentParts?: readonly Part[]): LiveCompiled {
    if (record?.body?.type !== 'live') return { program: this.compiler.compile(record, receivedAt) };
    let bytes = 0;
    for (const character of JSON.stringify(record)) { const code = character.codePointAt(0)!;
      bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
    if (bytes > 32768) throw Error('record_too_large');
    if (record.kind !== 'program' || record.policy !== 'replace') throw Error('live_replace_required');
    strictObject(record.body, ['type', 'program', 'configuration']);
    const configuration = validateConfiguration(record.body.configuration);
    if (configuration.sceneAppend) {
      if (configuration.transient === true || configuration.observerHandoffMs !== undefined) throw Error('scene_append_ownership');
      if (configuration.controls.length || configuration.poses.length) throw Error('scene_append_controls');
      record = appendScene(record, currentParts);
    }
    const program = this.compiler.compile({ ...record, body: record.body.program ?? { type: 'wait', durationMs: 0 } }, receivedAt);
    return { program, configuration };
  }
}
export function referencedParts(configuration: LiveConfiguration) {
  const result = new Set<string>();
  for (const item of configuration.controls) result.add(item.type === 'bind' ? item.target.part : item.type === 'orient' ? item.part : item.do.target.part);
  for (const item of configuration.poses) result.add(item.target.part);
  result.delete('body'); return result;
}
