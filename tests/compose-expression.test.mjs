import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Compiler } from '../src/core/compiler/compiler.ts';
import { composeExpression, compositionSchema, compositionTool, compositionContract } from '../integrations/compose-expression.mjs';
import { liveTestClient } from '../integrations/live-test-client.mjs';
const part = () => ({ id: 'authored', kind: 'ellipsoid', center: [0.2, 0, 0], scale: [0.2, 0.3, 0.1] });
const compile = body => new Compiler().compile({ v: 1, epoch: 'test', seq: 1, kind: 'program', track: 'body', policy: 'replace', body }, 0);
it('expands an omitted base to standalone geometry and the same existing compiler program', () => {
  const motion = { pivot: [0, 0, 0], translate: [0, 0.1, 0], rotate: [0, 0, 0.1], periodMs: 2000, phase: 0 };
  const input = { parts: [{ ...part(), motion }], durationMs: 500, style: { color: '#aB183F' }, flow: { field: 'pulse', strength: 0.1 }, requestId: 'owned', expectedEpoch: 'test' };
  const result = composeExpression(input);
  const manual = { type: 'parallel', children: [
    { type: 'assemble', parts: input.parts, durationMs: 500, easing: 'smoothstep' },
    { type: 'style', color: '#aB183F', durationMs: 500, easing: 'smoothstep' },
    { type: 'flow', field: 'pulse', strength: 0.1, durationMs: 500, easing: 'smoothstep' }] };
  expect(compile(result.body)).toEqual(compile(manual));
  expect(result).toMatchObject({ requestId: 'owned', expectedEpoch: 'test', policy: 'replace' });
  expect(result.body.children[0].parts).toHaveLength(1); input.parts[0].center[0] = 1;
  expect(result.body.children[0].parts[0].center[0]).toBe(0.2);
});
it('adds only an explicitly selected stable canonical base, with deterministic expansion and no renaming', () => {
  const input = { base: 'resting_face', parts: [part()] }, a = composeExpression(input);
  const face = JSON.parse(readFileSync(new URL('../src/core/live/face.json', import.meta.url), 'utf8')).parts;
  expect(a.body.children[0].parts).toEqual([...face, part()]); expect(composeExpression(input)).toEqual(a);
  expect(compositionContract.baseFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(() => composeExpression({ base: 'resting_face', parts: [{ ...part(), id: 'mouth' }] })).toThrow('composition_part_collision');
  expect(() => composeExpression({ base: 'resting_face', parts: Array.from({ length: 13 }, (_, i) => ({ ...part(), id: 'p' + i })) })).toThrow('composition_part_limit');
});
it('rejects invalid geometry, hidden language instructions and unsupported fields before expansion', () => {
  const invalid = [{ parts: [] }, { parts: [part()], prompt: 'make an emotion' }, { parts: [part()], base: 'current' },
    { parts: [{ ...part(), center: [NaN, 0, 0] }] }, { parts: [{ ...part(), center: [Infinity, 0, 0] }] },
    { parts: [{ ...part(), center: [2.1, 0, 0] }] }, { parts: [{ ...part(), scale: [0, 1, 1] }] },
    { parts: [{ id: 'x', kind: 'curve', points: Array.from({ length: 13 }, () => [0, 0, 0]), radius: 0.1 }] },
    { parts: [part()], style: { color: 'red' } }, { parts: [part()], style: {} }, { parts: [part()], durationMs: 10001 },
    { parts: [part()], flow: { field: 'pulse', strength: 2 } }, { parts: [part(), part()] }];
  for (const input of invalid) expect(() => composeExpression(input)).toThrow(/^composition_/);
});
it('advertises geometry rather than semantic presets with a compact concrete input contract', () => {
  expect(compositionTool.name).toBe('compose_expression'); expect(compositionSchema.required).toEqual(['parts']);
  expect(JSON.stringify(compositionSchema).length).toBeLessThan(5000);
  expect(Object.keys(compositionSchema.properties)).not.toContain('emotion');
  expect(Object.keys(compositionSchema.properties)).not.toContain('prompt');
});
it('rejects invalid composition and stale epoch through actual MCP before any gateway access', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.writeHead(500, { 'Content-Type': 'application/json' }).end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = liveTestClient(`http://127.0.0.1:${server.address().port}`, 'synthetic-compose-test-only');
  try {
    const list = await client.call('tools/list'); expect(list.tools.some(t => t.name === 'compose_expression')).toBe(true);
    const invalid = await client.tool('compose_expression', { base: 'resting_face', parts: [{ ...part(), id: 'mouth' }] });
    expect(invalid.isError).toBe(true); expect(invalid.content[0].text).toContain('composition_part_collision'); expect(requests).toBe(0);
    const stale = await client.tool('compose_expression', { parts: [part()], expectedEpoch: 'retired' });
    expect(stale.isError).toBe(true); expect(stale.content[0].text).toContain('expected_epoch_mismatch'); expect(requests).toBe(0);
    expect((await client.tool('compose_expression', { parts: [part()] })).isError).toBe(true); expect(requests).toBe(1);
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
}, 15000);

it('returns a bounded actionable patch constraint without echoing authored payloads', async () => {
  const triangle = { id: 'private-authored-id', kind: 'patch', points: [[0,0,0],[1,0,0],[0,1,0]] };
  const client = liveTestClient('http://127.0.0.1:1', 'synthetic-validation-only');
  try {
    const result = await client.tool('compose_expression', { parts: [triangle, { ...triangle, id: 'another-private-id' }] });
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(JSON.parse(text)).toEqual({ status: 'rejected', code: 'composition_arguments',
      details: [{ path: '/parts/0/points', rule: 'minItems', limit: 4 },
        { path: '/parts/1/points', rule: 'minItems', limit: 4 }] });
    expect(text).not.toContain(triangle.id);
    expect(() => composeExpression({ parts: [{ ...triangle, points: [...triangle.points, [0,0,0]] }] })).not.toThrow();
  } finally { await client.close(); }
});

const rootConstraints = [
  ['point size', { style: { pointSize: 9 } }, { path: '/style/pointSize', rule: 'maximum', limit: 8 }],
  ['RGB', { style: { color: 'PRIVATE_COLOR_VALUE' } }, { path: '/style/color', rule: 'pattern' }],
  ['upper duration', { durationMs: 10001 }, { path: '/durationMs', rule: 'maximum', limit: 10000 }],
  ['lower duration', { durationMs: -1 }, { path: '/durationMs', rule: 'minimum', limit: 0 }],
];
it.each(rootConstraints)('returns a sanitized root or style constraint for %s', (_name, invalid, expected) => {
  let failure;
  try { composeExpression({ parts: [{ ...part(), id: 'PRIVATE_PART_ID' }], ...invalid }); }
  catch (error) { failure = error; }
  expect(failure?.message).toBe('composition_arguments');
  expect(failure?.details).toEqual([expected]);
  expect(JSON.stringify(failure.details)).not.toContain('PRIVATE');
});

it('keeps valid arbitrary RGB and tiny point sizes unchanged', () => {
  for (const [color, pointSize] of [['#000000', 0], ['#aB013f', 0.01], ['#FFFFFF', 8]]) {
    const result = composeExpression({ parts: [part()], style: { color, pointSize } });
    expect(result.body.children[1]).toMatchObject({ color, pointSize });
    expect(compile(result.body).kind).toBe('program');
  }
});

it('redacts unknown property names and submitted values through MCP before gateway access', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.writeHead(500).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = liveTestClient(`http://127.0.0.1:${server.address().port}`, 'synthetic-diagnostics-only');
  try {
    const cases = [...rootConstraints.map(([_name, invalid, detail]) => [invalid, detail]),
      [{ PRIVATE_ROOT_NAME: 'PRIVATE_ROOT_VALUE' }, { path: '', rule: 'additionalProperties' }],
      [{ style: { PRIVATE_STYLE_NAME: 'PRIVATE_STYLE_VALUE' } }, { path: '/style', rule: 'additionalProperties' }]];
    for (const [invalid, detail] of cases) {
      const result = await client.tool('compose_expression', { parts: [{ ...part(), id: 'PRIVATE_PART_ID' }], ...invalid });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual({ status: 'rejected', code: 'composition_arguments',
        details: [detail] });
      expect(result.content[0].text).not.toContain('PRIVATE'); expect(requests).toBe(0);
    }
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
});

it('locates missing and unsupported kinds without echoing authored values', () => {
  const cases = [[{ ...part(), kind: 'PRIVATE_KIND' }, '/parts/0/kind', 'enum'],
    [{ id: 'PRIVATE_ID' }, '/parts/0/kind', 'required'], [null, '/parts/0', 'type']];
  for (const [value, path, rule] of cases) {
    let failure;
    try { composeExpression({ parts: [value] }); } catch (error) { failure = error; }
    expect(failure?.message).toBe('composition_arguments');
    expect(failure?.details).toEqual([{ path, rule }]);
    expect(JSON.stringify(failure.details)).not.toContain('PRIVATE');
  }
});
it('locates duplicate authored or base IDs and reports remaining part capacity', () => {
  const face = JSON.parse(readFileSync(new URL('../src/core/live/face.json', import.meta.url), 'utf8')).parts;
  const cases = [
    [{ parts: [part(), part()] }, 'composition_part_collision', [{ path: '/parts/1/id', rule: 'unique' }]],
    [{ base: 'resting_face', parts: [{ ...part(), id: face[0].id }] }, 'composition_part_collision', [{ path: '/parts/0/id', rule: 'unique' }]],
    [{ base: 'resting_face', parts: Array.from({ length: compositionSchema.properties.parts.maxItems }, (_, i) => ({ ...part(), id: `p${i}` })) },
      'composition_part_limit', [{ path: '/parts', rule: 'maxItems', limit: compositionSchema.properties.parts.maxItems - face.length }]]
  ];
  for (const [input, code, details] of cases) {
    let failure;
    try { composeExpression(input); } catch (error) { failure = error; }
    expect(failure?.message).toBe(code); expect(failure?.details).toEqual(details);
  }
  expect(() => composeExpression({ parts: [part(), { ...part(), id: 'distinct' }] })).not.toThrow();
});
it('bounds repair details through MCP and never sends rejected geometry to gateway', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.writeHead(500).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = liveTestClient(`http://127.0.0.1:${server.address().port}`, 'synthetic-repair-only');
  try {
    const cases = [
      [{ parts: Array.from({ length: 8 }, () => ({ ...part(), kind: 'PRIVATE_KIND' })) }, 'composition_arguments',
        [0, 1, 2].map(index => ({ path: `/parts/${index}/kind`, rule: 'enum' }))],
      [{ parts: Array.from({ length: 8 }, () => ({ ...part(), id: 'PRIVATE_ID' })) }, 'composition_part_collision',
        [1, 2, 3].map(index => ({ path: `/parts/${index}/id`, rule: 'unique' }))]
    ];
    for (const [input, code, details] of cases) {
      const result = await client.tool('compose_expression', input), text = result.content[0].text;
      expect(result.isError).toBe(true); expect(JSON.parse(text)).toEqual({ status: 'rejected', code, details });
      expect(text).not.toContain('PRIVATE'); expect(requests).toBe(0);
    }
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
});
