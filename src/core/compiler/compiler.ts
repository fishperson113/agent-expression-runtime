import { ExpressionError as Err, type Envelope, type Property, type Value } from '../ast/types';
import { validateSculpture } from '../geometry/validate';
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
type Lowered = { ops: Op[]; duration: number };
type LowerContext = { macros: Map<string, Macro>; stack: string[]; input: number; expanded: number; assemblies: number };
type AddOp = (property: Property, value: Value, strength?: number) => unknown;
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
  private envelope(raw: unknown): Obj {
    let encoded: string | undefined;
    try { encoded = JSON.stringify(raw); } catch { fail('not_json', '$'); }
    if (encoded === undefined) fail('not_json', '$');
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
    if (r.kind !== 'program' && (r.track !== undefined || r.policy !== undefined)) fail('unknown_field', '$.track');
    return r;
  }
  compile(raw: unknown, receivedAt: number): Compiled {
    const r = this.envelope(raw);
    const ttlMs = num(r.ttlMs ?? (r.kind === 'state' ? 1000 : 2000), '$.ttlMs', 0, 5000, true);
    const stamp = { epoch: r.epoch, seq: r.seq, ttlMs, receivedAt };
    if (r.kind === 'define') { this.define(r.body); return { ...stamp, kind: 'define' }; }
    if (r.kind === 'state') return { ...stamp, ...this.statePatch(r.body) };
    choice(r.track, ['body'], '$.track');
    choice(r.policy, ['append', 'replace'], '$.policy');
    const cacheKey = JSON.stringify([r.body, this.macroRevision, capability.revision]);
    let lowered = this.cache.get(cacheKey);
    if (!lowered) {
      lowered = this.lower(r.body, new Map(this.macros), []);
      this.cache.set(cacheKey, lowered);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    }
    return { ...stamp, kind: 'program', policy: r.policy, duration: lowered.duration,
      ops: structuredClone(lowered.ops), seed: this.seed };
  }
  private statePatch(raw: unknown) {
    const b = object(raw, '$.body');
    const ranges: Record<string, number[]> = { brightness: [0, 1], pointSize: [0, 8], dispersion: [0, 1],
      rise: [-1, 1], advance: [-1, 1], spread: [0.25, 2], grow: [0.25, 2] };
    keys(b, [...Object.keys(ranges), 'durationMs', 'easing'], '$.body');
    const patch: Record<string, number> = {};
    for (const [name, [min, max]] of Object.entries(ranges))
      if (b[name] !== undefined) patch[name] = num(b[name], '$.body.' + name, min, max);
    if (!Object.keys(patch).length) fail('empty_state', '$.body');
    return { kind: 'state' as const, patch, duration: num(b.durationMs ?? 250, '$.body.durationMs', 0, 10000, true),
      easing: easing(b.easing, '$.body.easing') };
  }
  private define(raw: unknown) {
    const b = object(raw, '$.body');
    keys(b, ['name', 'revision', 'params', 'body'], '$.body');
    text(b.name, '$.body.name');
    num(b.revision, '$.body.revision', 0, Number.MAX_SAFE_INTEGER, true);
    const params = object(b.params, '$.body.params');
    if (Object.keys(params).length > 8) fail('parameter_budget', '$.body.params');
    for (const [k, v] of Object.entries(params)) {
      if (!/^[a-zA-Z][\w]{0,63}$/.test(k)) fail('parameter_name', '$.body.params');
      choice(v, ['number', 'string'], '$.body.params');
    }
    const key = `${b.name}@${b.revision}`, snapshot = new Map(this.macros);
    if (snapshot.has(key)) fail('immutable_revision', '$.body.revision');
    if (snapshot.size >= 32) fail('macro_budget', '$.body');
    snapshot.set(key, b as Macro);
    this.lower(this.probe(b.body, params), snapshot, []);
    this.macros.set(key, structuredClone(b as Macro));
    this.macroRevision++;
  }
  private probe(raw: unknown, params: Obj, field = ''): unknown {
    if (Array.isArray(raw)) return raw.map(value => this.probe(value, params, field));
    if (!raw || typeof raw !== 'object') return raw;
    const node = raw as Obj;
    if (node.type !== 'param')
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, this.probe(value, params, key)]));
    keys(node, ['type', 'name'], '$.body.body');
    if (!Object.hasOwn(params, node.name)) fail('unknown_parameter', '$.body.body');
    const kind = params[node.name];
    const numeric = ['durationMs', 'strength', 'brightness', 'pointSize', 'dispersion',
      'rise', 'advance', 'spread', 'grow', 'time', 'weight', 'flow'].includes(field);
    const symbolic = ['target', 'field', 'color', 'easing'].includes(field);
    if ((numeric && kind !== 'number') || (symbolic && kind !== 'string')) fail('parameter_type', '$.body.body');
    if (kind === 'number') return field === 'periodMs' ? 2000 : ['spread', 'grow', 'scale', 'weight'].includes(field) ? 1 : 0;
    return ({ target: 'sphere', field: 'orbit', color: '#79e6d3', easing: 'linear' }[field] ?? 'sphere');
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
  private lower(raw: unknown, macros: Map<string, Macro>, stack: string[]): Lowered {
    return this.walk(raw, '$.body', 0, 0, false, { macros, stack, input: 0, expanded: 0, assemblies: 0 });
  }
  private walk(value: unknown, p: string, depth: number, at: number, inMacro: boolean, context: LowerContext): Lowered {
    if (depth > 16) fail('depth_budget', p);
    if (++context.expanded > 512) fail('expansion_budget', p);
    if (!inMacro && ++context.input > 128) fail('input_budget', p);
    const n = object(value, p), type = choice(n.type, capability.nodes, p + '.type');
    if (type === 'assemble' && ++context.assemblies > capability.assembly.nodes) fail('assembly_budget', p);
    if (type === 'call') return this.call(n, p, depth, at, context);
    if (type === 'sequence' || type === 'parallel') return this.group(n, p, depth, at, inMacro, context);
    return this.primitive(n, p, at);
  }
  private call(n: Obj, p: string, depth: number, at: number, context: LowerContext): Lowered {
    keys(n, ['type', 'name', 'revision', 'args'], p);
    text(n.name, p + '.name');
    num(n.revision, p + '.revision', 0, Number.MAX_SAFE_INTEGER, true);
    const key = `${n.name}@${n.revision}`;
    if (context.stack.includes(key)) fail('macro_cycle', p);
    const macro = context.macros.get(key) ?? fail('unknown_macro', p);
    const args = object(n.args, p + '.args');
    keys(args, Object.keys(macro.params), p + '.args');
    for (const [name, type] of Object.entries(macro.params)) {
      if (typeof args[name] !== type) fail('parameter_type', p + '.args.' + name);
      if (type === 'number') num(args[name], p + '.args.' + name, -10000, 10000);
    }
    context.stack.push(key);
    const result = this.walk(this.substitute(macro.body, args, p), p + '.expanded', depth + 1, at, true, context);
    context.stack.pop();
    return result;
  }
  private group(n: Obj, p: string, depth: number, at: number, inMacro: boolean, context: LowerContext): Lowered {
    keys(n, ['type', 'children'], p);
    if (!Array.isArray(n.children) || !n.children.length || n.children.length > 128) fail('children', p);
    let duration = 0;
    const branches: Op[][] = [];
    for (let i = 0; i < n.children.length; i++) {
      const child = this.walk(n.children[i], `${p}.children[${i}]`, depth + 1,
        at + (n.type === 'sequence' ? duration : 0), inMacro, context);
      branches.push(child.ops);
      duration = n.type === 'sequence' ? duration + child.duration : Math.max(duration, child.duration);
    }
    if (duration > 10000) fail('duration_budget', p);
    if (n.type === 'parallel') this.conflicts(branches, p);
    return { ops: this.mergeEffort(branches.flat()), duration };
  }
  private conflicts(branches: Op[][], p: string) {
    for (let i = 0; i < branches.length; i++) for (let j = i + 1; j < branches.length; j++)
      for (const a of branches[i]) for (const b of branches[j]) {
        if (a.property !== b.property || a.at >= b.at + Math.max(b.duration, 0.001) ||
            b.at >= a.at + Math.max(a.duration, 0.001)) continue;
        if (a.property === 'effortFlow' && a.value === b.value) continue;
        fail('property_conflict', p);
      }
  }
  private mergeEffort(ops: Op[]): Op[] {
    const merged: Op[] = [];
    for (const op of ops.filter(op => op.property === 'effortFlow').sort((a, b) => a.at - b.at)) {
      const previous = merged.at(-1);
      if (previous && previous.value === op.value && previous.at + previous.duration >= op.at) {
        previous.duration = Math.max(previous.at + previous.duration, op.at + op.duration) - previous.at;
        previous.easing = 'smoothstep';
        delete previous.effort;
      } else merged.push({ ...op });
    }
    return [...ops.filter(op => op.property !== 'effortFlow'), ...merged];
  }
  private primitive(n: Obj, p: string, at: number): Lowered {
    const fields: Record<string, string[]> = { morph: ['target'], assemble: ['parts'], flow: ['field', 'strength'],
      style: ['color', 'brightness', 'pointSize', 'dispersion'],
      shapeQuality: ['rise', 'advance', 'spread', 'grow', 'path'], wait: [] };
    keys(n, ['type', 'durationMs', ...(n.type === 'wait' ? [] : ['easing', 'effort']), ...fields[n.type]], p);
    const duration = num(n.durationMs, p + '.durationMs', 0, 10000, true);
    const ease = n.type === 'wait' ? 'linear' : easing(n.easing, p + '.easing');
    const effort = n.effort === undefined ? undefined : object(n.effort, p + '.effort');
    if (effort) {
      keys(effort, ['time', 'weight', 'flow'], p + '.effort');
      for (const key of Object.keys(effort)) num(effort[key], p + '.effort.' + key, 0, 1);
    }
    const ops: Op[] = [];
    const add = (property: Property, value: Value, strength?: number) =>
      ops.push({ at, duration, easing: ease, property, value, ...(effort ? { effort } : {}),
        ...(strength === undefined ? {} : { strength }) });
    if (n.type === 'shapeQuality') this.quality(n, p, ops, add);
    if (n.type === 'morph') add('shape', choice(n.target, primitives.morph.targets, p + '.target'));
    if (n.type === 'assemble') add('shape', validateSculpture({ parts: n.parts }, p));
    if (n.type === 'flow') add('flow', choice(n.field, primitives.flow.fields, p + '.field'), num(n.strength, p + '.strength', 0, 1));
    if (n.type === 'style') this.style(n, p, ops, add);
    if (effort?.flow !== undefined) add('effortFlow', effort.flow);
    return { ops, duration };
  }
  private quality(n: Obj, p: string, ops: Op[], add: AddOp) {
    for (const prop of ['rise', 'advance', 'spread', 'grow'] as const)
      if (n[prop] !== undefined) {
        const position = prop === 'rise' || prop === 'advance';
        add(prop, num(n[prop], p + '.' + prop, position ? -1 : 0.25, position ? 1 : 2));
      }
    if (!ops.length) fail('empty_shape_quality', p);
    if (choice(n.path ?? 'spoke', ['spoke', 'arc'], p + '.path') === 'arc') {
      if (n.rise === undefined && n.advance === undefined) fail('arc_requires_translation', p);
      add('arcOffset', 0);
      ops[ops.length - 1].arcAmplitude = 0.25;
    }
  }
  private style(n: Obj, p: string, ops: Op[], add: AddOp) {
    for (const prop of primitives.style.writes) {
      if (n[prop] === undefined) continue;
      if (prop === 'color') {
        if (typeof n.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(n.color)) fail('color', p + '.color');
        add(prop, n.color);
      } else add(prop, num(n[prop], p + '.' + prop, 0, prop === 'pointSize' ? 8 : 1));
    }
    if (!ops.length) fail('empty_style', p);
  }
}
