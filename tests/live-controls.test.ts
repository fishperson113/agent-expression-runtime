import { expect, it } from 'vitest';
import { LiveCompiler } from '../src/core/live/compiler';
import { validateConfiguration } from '../src/core/live/control-validation';

const bind = { type: 'bind', id: 'chosen', signal: 'agent.output', target: { part: 'p3', prop: 'scaleY' },
  gain: 0.6, offset: 1, clamp: [0.5, 1.6], smoothMs: 80 };
const config = () => ({ controls: [bind], poses: [], lifetimeMs: 60000 });
it('accepts bounded transforms while rejecting unknown signals, code and same-layer writes', () => {
  expect(validateConfiguration(config()).controls).toHaveLength(1);
  expect(() => validateConfiguration({ ...config(), controls: [{ ...bind, signal: 'user.password' }] })).toThrow('live_signal');
  expect(() => validateConfiguration({ ...config(), controls: [bind, { ...bind, id: 'other' }] })).toThrow('live_property_conflict');
  expect(() => validateConfiguration({ ...config(), code: 'run()' })).toThrow('live_fields');
  expect(() => validateConfiguration({ ...config(), lifetimeMs: Infinity })).toThrow('live_range');
});
it('compiles the complete Live command before installation and preserves legacy commands', () => {
  const compiler = new LiveCompiler(), envelope = { v: 1, epoch: 'live', seq: 1, kind: 'program', track: 'body', policy: 'replace' };
  const result = compiler.compile({ ...envelope, body: { type: 'live', program: { type: 'wait', durationMs: 100 }, configuration: config() } }, 0);
  expect(result.program.kind).toBe('program'); expect(result.configuration?.controls).toHaveLength(1);
  expect(() => compiler.compile({ ...envelope, body: { type: 'live', program: { type: 'wait', durationMs: -1 }, configuration: config() } }, 0)).toThrow();
  expect(compiler.compile({ ...envelope, body: { type: 'wait', durationMs: 10 } }, 0).configuration).toBeUndefined();
});
