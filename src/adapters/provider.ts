import type { Envelope } from '../core/ast/types';
import { capability } from '../primitives/registry';
export interface AgentStreamAdapter {
  start(
    prompt: string,
    epoch: string,
    onContent: (text: string) => void,
    onExpression: (record: Envelope) => void,
    onDone: () => void,
  ): () => void;
}
export const capabilityPrompt = () =>
  `Expression capability (declarative data only): ${JSON.stringify(capability)}. Emit independent program/state/define events alongside content. Never await expression execution.`;
/** Scripted capability demo. It does not infer emotions or call a model. */
export class FakeAgent implements AgentStreamAdapter {
  start(
    _prompt: string,
    epoch: string,
    content: (text: string) => void,
    expression: (record: Envelope) => void,
    done: () => void,
  ) {
    let index = 0,
      seq = 0;
    const words =
      'This is a scripted stream, not a model response. Content keeps arriving while the expression compiler works independently. The body can move from a sphere into a wall, then a wave and a cloud using a small declarative program. Cancel this turn at any time, or try a program in the inspector.'.split(
        ' ',
      );
    const timer = setInterval(() => {
      if (index >= words.length) {
        clearInterval(timer);
        done();
        return;
      }
      content(words[index++] + ' ');
      if (index === 1 || index % 14 === 0) {
        const shapes = ['sphere', 'wall', 'wave', 'cloud'] as const;
        expression({
          v: 1,
          epoch,
          seq: ++seq,
          kind: 'program',
          track: 'body',
          policy: 'replace',
          body: {
            type: 'parallel',
            children: [
              { type: 'morph', target: shapes[(seq - 1) % 4], durationMs: 900 },
              {
                type: 'flow',
                field: seq % 2 ? 'orbit' : 'pulse',
                strength: 0.35,
                durationMs: 1800,
              },
            ],
          },
        });
      }
    }, 25);
    return () => clearInterval(timer);
  }
}
