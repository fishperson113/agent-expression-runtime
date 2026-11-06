import { expect, it } from 'vitest';
import { TerminalEngine } from '../src/terminal/runtime';

it('renders the real compiler/scheduler particle body without a browser or WebGL', () => {
  let now = 0;
  const engine = new TerminalEngine(() => now);
  const sphere = Buffer.from(engine.frame(256, 160));
  expect(sphere).toHaveLength(256 * 160 * 3);
  expect(engine.express({ body: { type: 'morph', target: 'wall', durationMs: 100 } }).status).toBe('accepted');
  now = 100;
  expect(engine.frame(256, 160)).not.toEqual(sphere);
  expect(engine.state.shape).toBe('wall');
  engine.dispose();
});
it('keeps typed macros, diagnostics, framing and cancellation on the shared runtime', () => {
  let now = 0;
  const engine = new TerminalEngine(() => now);
  engine.express({ kind: 'define', body: { name: 'vui', revision: 1, params: {},
    body: { type: 'shapeQuality', rise: 1, grow: 2, durationMs: 100 } } });
  expect(engine.express({ body: { type: 'call', name: 'vui', revision: 1, args: {} } }).status).toBe('accepted');
  now = 50; engine.frame(256, 160);
  expect(Number(engine.state.rise)).toBeGreaterThan(0);
  engine.cancel(); now += 250; engine.frame(256, 160);
  expect(engine.state.rise).toBe(0);
  expect(() => engine.express({ body: { type: 'morph', target: 'wrong', durationMs: 1 } })).toThrow();
  engine.dispose();
});
