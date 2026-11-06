import { ExpressionError as Err, type Envelope, type Property } from '../ast/types';
import type { Compiled, Op } from '../runtime/ir';
import { capability, primitives } from '../../primitives/registry';
type Obj = Record<string, any>;
const fail = (code: string, path: string): never => {
  throw new Err(code, path);
};
function object(x: unknown, p: string): Obj {
  if (!x || typeof x !== 'object' || Array.isArray(x)) fail('object', p);
  return x as Obj;
}
function keys(x: Obj, allowed: string[], p: string) {
  for (const k of Object.keys(x)) if (!allowed.includes(k)) fail('unknown_field', `${p}.${k}`);
}
function num(x: unknown, p: string, min = 0, max = 10000, integer = false): number {
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    x < min ||
    x > max ||
    (integer && !Number.isInteger(x))
  )
    fail('range', p);
  return x as number;
}
function text(x: unknown, p: string): string {
  if (typeof x !== 'string' || !x.length || x.length > 128) fail('string', p);
  return x as string;
}
function choice(x: unknown, values: readonly string[], p: string): string {
  if (typeof x !== 'string' || !values.includes(x)) fail('enum', p);
  return x as string;
}
const easing = (x: unknown, p: string) =>
  choice(x ?? 'smoothstep', ['linear', 'smoothstep'], p) as 'linear' | 'smoothstep';
type Macro = {
  name: string;
  revision: number;
  params: Record<string, 'number' | 'string'>;
  body: unknown;
};
export class Compiler {
  constructor(private seed = 42) {}
  private macros = new Map<string, Macro>();
  private cache = new Map<string, { ops: Op[]; duration: number }>();
  private macroRevision = 0;
  private nextDraft = 0;
  private drafts = new Map<number, { key: string; macro: Macro }>();
  discardDefinitions() {
    this.drafts.clear();
  }
  prepareDefinition(raw: unknown, receivedAt: number): Compiled {
    if (this.drafts.size >= 4) fail('definition_mailbox_full', '$');
    const candidate = new Compiler(this.seed);
    candidate.macros = new Map(this.macros);
    const ir = candidate.compile(raw, receivedAt);
    if (ir.kind !== 'define') fail('definition_required', '$');
    const [key, macro] = [...candidate.macros].find(([key]) => !this.macros.has(key))!;
    if ([...this.drafts.values()].some((d) => d.key === key)) fail('definition_pending', '$.body');
    if (this.macros.size + this.drafts.size >= 32) fail('macro_budget', '$.body');
    const draft = ++this.nextDraft;
    this.drafts.set(draft, { key, macro });
    return {
      kind: 'define',
      epoch: ir.epoch,
      seq: ir.seq,
      draft,
      ttlMs: 'ttlMs' in ir ? ir.ttlMs : 2000,
      receivedAt,
    };
  }
  settleDefinition(draft: number, accepted: boolean) {
    const staged = this.drafts.get(draft);
    this.drafts.delete(draft);
    if (staged && accepted) {
      this.macros.set(staged.key, staged.macro);
      this.macroRevision++;
    }
  }
  get sizes() {
    return { macros: this.macros.size, cache: this.cache.size };
  }
  reset() {
    this.drafts.clear();
    this.macros.clear();
    this.cache.clear();
    this.macroRevision++;
  }
  compile(raw: unknown, receivedAt: number): Compiled {
    let encoded: string;
    try {
      encoded = JSON.stringify(raw);
    } catch {
      fail('not_json', '$');
    }
    let bytes = 0;
    for (const char of encoded!) {
      const cp = char.codePointAt(0)!;
      bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
    }
    if (bytes > 32768) fail('record_too_large', '$');
    const r = object(raw, '$');
    keys(r, ['v', 'epoch', 'seq', 'kind', 'ttlMs', 'track', 'policy', 'body'], '$');
    if (r.v !== 1) fail('version', '$.v');
    text(r.epoch, '$.epoch');
    num(r.seq, '$.seq', 0, Number.MAX_SAFE_INTEGER, true);
    choice(r.kind, ['program', 'state', 'define'], '$.kind');
    const ttlMs = num(r.ttlMs ?? (r.kind === 'state' ? 1000 : 2000), '$.ttlMs', 0, 5000, true);
    if (r.kind !== 'program' && (r.track !== undefined || r.policy !== undefined))
      fail('unknown_field', '$.track');
    const snapshot = new Map(this.macros);
    if (r.kind === 'define') {
      const b = object(r.body, '$.body');
      keys(b, ['name', 'revision', 'params', 'body'], '$.body');
      text(b.name, '$.body.name');
      num(b.revision, '$.body.revision', 0, Number.MAX_SAFE_INTEGER, true);
      const params = object(b.params, '$.body.params');
      if (Object.keys(params).length > 8) fail('parameter_budget', '$.body.params');
      for (const [k, v] of Object.entries(params)) {
        if (!/^[a-zA-Z][\w]{0,63}$/.test(k)) fail('parameter_name', '$.body.params');
        choice(v, ['number', 'string'], '$.body.params');
      }
      const key = `${b.name}@${b.revision}`;
      if (snapshot.has(key)) fail('immutable_revision', '$.body.revision');
      if (snapshot.size >= 32) fail('macro_budget', '$.body');
      const macro = b as Macro;
      snapshot.set(key, macro);
      // Validate template using representative typed values, then expand before commit.
      const probe = (raw: unknown, field = ''): unknown => {
        if (Array.isArray(raw)) return raw.map((x) => probe(x, field));
        if (raw && typeof raw === 'object') {
          const o = raw as Obj;
          if (o.type === 'param') {
            keys(o, ['type', 'name'], '$.body.body');
            if (!Object.hasOwn(params, o.name)) fail('unknown_parameter', '$.body.body');
            const kind = params[o.name];
            if (!kind) fail('unknown_parameter', '$.body.body');
            const numeric = [
              'durationMs',
              'strength',
              'brightness',
              'pointSize',
              'dispersion',
            ].includes(field);
            const symbolic = ['target', 'field', 'color', 'easing'].includes(field);
            if ((numeric && kind !== 'number') || (symbolic && kind !== 'string'))
              fail('parameter_type', '$.body.body');
            return kind === 'number'
              ? 0
              : ({ target: 'sphere', field: 'orbit', color: '#79e6d3', easing: 'linear' }[field] ??
                  'sphere');
          }
          return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, probe(v, k)]));
        }
        return raw;
      };
      this.lower(probe(b.body), snapshot, [], true);
      this.macros.set(key, structuredClone(macro));
      this.macroRevision++;
      return { kind: 'define', epoch: r.epoch, seq: r.seq, ttlMs, receivedAt };
    }
    if (r.kind === 'state') {
      const b = object(r.body, '$.body');
      keys(b, ['brightness', 'pointSize', 'dispersion', 'durationMs', 'easing'], '$.body');
      const patch: Record<string, number> = {};
      for (const p of ['brightness', 'pointSize', 'dispersion'])
        if (b[p] !== undefined) patch[p] = num(b[p], `$.body.${p}`, 0, p === 'pointSize' ? 8 : 1);
      if (!Object.keys(patch).length) fail('empty_state', '$.body');
      return {
        kind: 'state',
        epoch: r.epoch,
        seq: r.seq,
        ttlMs,
        receivedAt,
        patch,
        duration: num(b.durationMs ?? 250, '$.body.durationMs', 0, 10000, true),
        easing: easing(b.easing, '$.body.easing'),
      };
    }
    choice(r.track, ['body'], '$.track');
    choice(r.policy, ['append', 'replace'], '$.policy');
    const cacheKey = JSON.stringify([r.body, this.macroRevision, capability.revision]);
    let lowered = this.cache.get(cacheKey);
    if (!lowered) {
      lowered = this.lower(r.body, snapshot, []);
      this.cache.set(cacheKey, lowered);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    }
    return {
      kind: 'program',
      epoch: r.epoch,
      seq: r.seq,
      ttlMs,
      receivedAt,
      policy: r.policy,
      duration: lowered.duration,
      ops: structuredClone(lowered.ops),
      seed: this.seed,
    };
  }
  private substitute(raw: unknown, args: Obj, p: string): unknown {
    if (Array.isArray(raw)) return raw.map((v, i) => this.substitute(v, args, `${p}[${i}]`));
    if (raw && typeof raw === 'object') {
      const o = raw as Obj;
      if (o.type === 'param') {
        keys(o, ['type', 'name'], p);
        if (!Object.hasOwn(args, o.name)) fail('unknown_parameter', p);
        return args[o.name];
      }
      return Object.fromEntries(
        Object.entries(o).map(([k, v]) => [k, this.substitute(v, args, `${p}.${k}`)]),
      );
    }
    return raw;
  }
  private lower(
    raw: unknown,
    macros: Map<string, Macro>,
    stack: string[],
    template = false,
  ): { ops: Op[]; duration: number } {
    let input = 0,
      expanded = 0;
    const walk = (
      value: unknown,
      p: string,
      depth: number,
      at: number,
      inMacro = false,
    ): { ops: Op[]; duration: number } => {
      if (depth > 16) fail('depth_budget', p);
      if (++expanded > 512) fail('expansion_budget', p);
      if (!inMacro && ++input > 128) fail('input_budget', p);
      const n = object(value, p);
      const type = choice(
        n.type,
        ['morph', 'flow', 'style', 'shapeQuality', 'wait', 'sequence', 'parallel', 'call'],
        `${p}.type`,
      );
      if (type === 'call') {
        keys(n, ['type', 'name', 'revision', 'args'], p);
        text(n.name, p + '.name');
        num(n.revision, p + '.revision', 0, Number.MAX_SAFE_INTEGER, true);
        const key = `${n.name}@${n.revision}`;
        if (stack.includes(key)) fail('macro_cycle', p);
        const m = macros.get(key) ?? fail('unknown_macro', p);
        const args = object(n.args, p + '.args');
        keys(args, Object.keys(m.params), p + '.args');
        for (const [k, t] of Object.entries(m.params)) {
          if (typeof args[k] !== t) fail('parameter_type', p + '.args.' + k);
          if (t === 'number') num(args[k], p + '.args.' + k, -10000, 10000);
        }
        stack.push(key);
        const result = walk(this.substitute(m.body, args, p), p + '.expanded', depth + 1, at, true);
        stack.pop();
        return result;
      }
      if (type === 'sequence' || type === 'parallel') {
        keys(n, ['type', 'children'], p);
        if (!Array.isArray(n.children) || !n.children.length || n.children.length > 128)
          fail('children', p);
        let duration = 0;
        const ops: Op[] = [],
          branches: Op[][] = [];
        for (let i = 0; i < n.children.length; i++) {
          const child = walk(
            n.children[i],
            `${p}.children[${i}]`,
            depth + 1,
            at + (type === 'sequence' ? duration : 0),
            inMacro,
          );
          ops.push(...child.ops);
          branches.push(child.ops);
          duration =
            type === 'sequence' ? duration + child.duration : Math.max(duration, child.duration);
        }
        if (duration > 10000) fail('duration_budget', p);
        if (type === 'parallel')
          for (let i = 0; i < branches.length; i++)
            for (let j = i + 1; j < branches.length; j++)
              for (const a of branches[i])
                for (const b of branches[j]) {
                  if (
                    a.property === b.property &&
                    a.at < b.at + Math.max(b.duration, 0.001) &&
                    b.at < a.at + Math.max(a.duration, 0.001)
                  )
                    fail('property_conflict', p);
                }
        return { ops, duration };
      }
      const allowed =
        type === 'morph'
          ? ['target']
          : type === 'flow'
            ? ['field', 'strength']
            : type === 'style'
              ? ['color', 'brightness', 'pointSize', 'dispersion']
              : [];
      keys(
        n,
        [
          'type',
          'durationMs',
          ...(type === 'wait' ? [] : ['easing', 'effort']),
          ...allowed,
          ...(type === 'shapeQuality'
            ? ['rise', 'advance', 'spread', 'grow', 'path', 'effort']
            : []),
        ],
        p,
      );
      const duration = num(n.durationMs, p + '.durationMs', 0, 10000, true),
        ease = type === 'wait' ? 'linear' : easing(n.easing, p + '.easing');
      const ops: Op[] = [];
      const effort = n.effort === undefined ? undefined : object(n.effort, p + '.effort');
      if (effort) {
        keys(effort, ['time', 'weight', 'flow'], p + '.effort');
        for (const key of Object.keys(effort)) num(effort[key], p + '.effort.' + key, 0, 1);
      }
      const add = (property: Property, value: string | number, strength?: number) =>
        ops.push({
          at,
          duration,
          easing: ease,
          property,
          value,
          ...(effort ? { effort } : {}),
          ...(strength === undefined ? {} : { strength }),
        });
      if (type === 'shapeQuality') {
        for (const prop of ['rise', 'advance', 'spread', 'grow'] as const)
          if (n[prop] !== undefined) {
            add(
              prop,
              num(
                n[prop],
                p + '.' + prop,
                prop === 'rise' || prop === 'advance' ? -1 : 0.25,
                prop === 'rise' || prop === 'advance' ? 1 : 2,
              ),
            );
            ops[ops.length - 1].effort = effort;
          }
        if (!ops.length) fail('empty_shape_quality', p);
        const path = choice(n.path ?? 'spoke', ['spoke', 'arc'], p + '.path');
        if (path === 'arc') {
          if (n.rise === undefined && n.advance === undefined) fail('arc_requires_translation', p);
          add('arcOffset', 0);
          ops[ops.length - 1].arcAmplitude = 0.25;
          ops[ops.length - 1].effort = effort;
        }
      }
      if (type === 'morph') add('shape', choice(n.target, primitives.morph.targets, p + '.target'));
      if (type === 'flow')
        add(
          'flow',
          choice(n.field, primitives.flow.fields, p + '.field'),
          num(n.strength, p + '.strength', 0, 1),
        );
      if (type === 'style') {
        for (const prop of primitives.style.writes) {
          if (n[prop] === undefined) continue;
          if (prop === 'color') {
            if (typeof n.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(n.color))
              fail('color', p + '.color');
            add(prop, n.color);
          } else add(prop, num(n[prop], p + '.' + prop, 0, prop === 'pointSize' ? 8 : 1));
        }
        if (!ops.length) fail('empty_style', p);
      }
      if (effort?.flow !== undefined) add('effortFlow', effort.flow);
      return { ops, duration };
    };
    void template;
    return walk(raw, '$.body', 0, 0);
  }
}
