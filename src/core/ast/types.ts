export type Shape = 'sphere' | 'wall' | 'wave' | 'cloud' | 'pin' | 'screw' | 'pyramid';
export type Field = 'orbit' | 'turbulence' | 'pulse';
export type Easing = 'linear' | 'smoothstep';
export type Property =
  | 'shape'
  | 'flow'
  | 'color'
  | 'brightness'
  | 'pointSize'
  | 'dispersion'
  | 'rise'
  | 'advance'
  | 'spread'
  | 'grow'
  | 'arcOffset'
  | 'effortFlow';
export type Value = number | string;
export type Param = { type: 'param'; name: string };
export type Effort = { time?: number; weight?: number; flow?: number };
export type Node =
  | {
      type: 'shapeQuality';
      rise?: number;
      advance?: number;
      spread?: number;
      grow?: number;
      path?: 'spoke' | 'arc';
      effort?: { time?: number; weight?: number; flow?: number };
      durationMs: number;
      easing?: Easing;
    }
  | { type: 'morph'; target: Shape; durationMs: number; easing?: Easing; effort?: Effort }
  | {
      type: 'flow';
      field: Field;
      strength: number;
      durationMs: number;
      easing?: Easing;
      effort?: Effort;
    }
  | {
      type: 'style';
      effort?: Effort;
      color?: string;
      brightness?: number;
      pointSize?: number;
      dispersion?: number;
      durationMs: number;
      easing?: Easing;
    }
  | { type: 'wait'; durationMs: number }
  | { type: 'sequence' | 'parallel'; children: Node[] }
  | { type: 'call'; name: string; revision: number; args: Record<string, Value> };
export type Envelope = { v: 1; epoch: string; seq: number; ttlMs?: number } & (
  | { kind: 'program'; track: 'body'; policy: 'append' | 'replace'; body: Node }
  | {
      kind: 'state';
      body: {
        brightness?: number;
        pointSize?: number;
        dispersion?: number;
        rise?: number;
        advance?: number;
        spread?: number;
        grow?: number;
        durationMs?: number;
        easing?: Easing;
      };
    }
  | {
      kind: 'define';
      body: {
        name: string;
        revision: number;
        params: Record<string, 'number' | 'string'>;
        body: unknown;
      };
    }
);
export class ExpressionError extends Error {
  constructor(
    public code: string,
    public path: string,
    message = code,
  ) {
    super(message);
  }
}
