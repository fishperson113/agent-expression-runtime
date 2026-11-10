import { expect, it } from 'vitest';
import { modelPlanner } from '../integrations/planner-provider.mjs';
import { planBody } from '../integrations/expression-plan.mjs';
import { parseReactiveResponse } from '../integrations/reactive-decision.mjs';
import { validateBriefV2Body } from '../src/core/live/decision-contract';
import { LiveCompiler } from '../src/core/live/compiler';
import { TerminalEngine } from '../src/terminal/runtime';
import { brailleFrame } from '../integrations/pane-display.mjs';

const phrase = (color, durationMs = 500) => ({ type: 'sequence', children: [{ type: 'parallel', children: [{ type: 'style', color, durationMs }] }] });
const request = { schemaVersion: 2, sessionId: 's', epoch: 'e', requestId: 'r', intentRevision: 0, presenceRevision: 0,
  deadline: 5000, requiredTrackIds: [], semanticSnapshot: { orientation: null, expression: null, handMotion: null, handIdentity: 0 } };
const decision = (body) => ({ schemaVersion: 2, requestId: 'r', decisionId: 'd', mode: 'express', validUntil: 4900,
  prerequisites: [], action: { actionId: 'a', body } });
const response = (value) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
it('passes arbitrary RGB, including black and white, through Node schema, host validation and compiler', () => {
  let seed = 1023;
  const colors = ['#000000', '#FFFFFF', ...Array.from({ length: 32 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return '#' + (seed & 0xffffff).toString(16).padStart(6, '0');
  })];
  for (const color of colors) {
    const body = phrase(color);
    const parsed = parseReactiveResponse(response(decision(body)), request, 2);
    expect(() => validateBriefV2Body(parsed.action.body)).not.toThrow();
    const compiled = new LiveCompiler().compile({ v: 1, epoch: 'e', seq: 1, kind: 'program', track: 'body', policy: 'replace', body }, 0);
    expect(compiled.program.duration).toBe(500);
    expect(JSON.stringify(compiled)).toContain(color);
  }
});
it('rejects non-RGB color payloads, style side channels and out-of-bounds reactive durations', () => {
  for (const color of ['red', '#fff', '#12345678', '#gg1122', 'rgb(1,2,3)', '<script>']) {
    expect(() => parseReactiveResponse(response(decision(phrase(color))), request, 2)).toThrow();
    expect(() => validateBriefV2Body(phrase(color))).toThrow();
  }
  for (const patch of [{ brightness: 1 }, { easing: 'linear' }, { durationMs: 199 }, { durationMs: 1001 }]) {
    const body = phrase('#1a72c3'); Object.assign(body.children[0].children[0], patch);
    expect(() => parseReactiveResponse(response(decision(body)), request, 2)).toThrow();
    expect(() => validateBriefV2Body(body)).toThrow();
  }
});
it('carries a planner-chosen RGB through terminal compilation, actual pixels and truecolor Braille', async () => {
  let now = 0, sent;
  const color = '#2595d3', engine = new TerminalEngine(() => now);
  const plan = { eventId: 'a'.repeat(64), mood: 'neutral', intensity: 0.5, target: 'user', concept: 'Arbitrary RGB fixture',
    body: phrase(color), performance: null, idleScenes: [] };
  plan.body.children[0].children.unshift({ type: 'assemble', durationMs: 500,
    parts: [{ id: 'invented', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.6, 0.4, 0.1] }] });
  const planner = modelPlanner({ enabled: true, model: 'fixture', endpoint: 'http://127.0.0.1:1/responses' }, async (_url, options) => {
    sent = JSON.parse(options.body); return new Response(JSON.stringify(response(plan)));
  });
  try {
    const parsed = await planner({ event: { id: 'synthetic' } }, new AbortController().signal);
    expect(sent.instructions).toContain('Choose any RGB color');
    expect(engine.express({ body: planBody(parsed, true) }).status).toBe('accepted');
    engine.frame(128, 96); now = 500; const pixels = engine.frame(128, 96);
    expect(engine.state.color).toBe(color);
    const target = [37, 149, 211]; let nearest = Infinity;
    for (let i = 0; i < pixels.length; i += 3) nearest = Math.min(nearest, target.reduce((sum, v, c) => sum + Math.abs(v - pixels[i + c]), 0));
    expect(nearest).toBeLessThan(12);
    const text = brailleFrame(pixels, 128, 96, 32, 24, true);
    const triples = [...text.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map(match => match.slice(1).map(Number));
    expect(triples.some(rgb => rgb[2] > rgb[1] && rgb[1] > rgb[0] && rgb[1] > 100)).toBe(true);
  } finally { engine.dispose(); }
});
