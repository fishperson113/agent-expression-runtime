import { expressionResponseSchema, parseExpressionResponse } from '../integrations/expression-response.mjs';
import { nativeVisualAuthoringGuide } from '../integrations/native-visual-authoring.mjs';
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
    const list = await client.call('tools/list');
    const tool = list.tools.find(t => t.name === 'compose_expression');
    expect(tool.description).toContain('standalone replacement, not append');
    expect(tool.description).toContain('stable IDs and motion/track data');
    expect(tool.description).toContain('Clarify unresolved spatial references');
    expect(tool.description).toContain('24-part limit includes retained parts');
    expect(tool.description).toContain('scene_append_part_limit_remaining_N');
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
    [{ id: 'PRIVATE_ID' }, '/parts/0/kind', 'required'], [null, '/parts/0', 'type'], [[], '/parts/0', 'type']];
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

it('preserves authored rigid group trajectories through compose and compilation', () => {
  const trajectory = { group: 'actor', pivot: [0, 0, 0], keyframes: [
    { atMs: 0, translate: [0, 0, 0], rotate: [0, 0, 0] },
    { atMs: 1200, translate: [1, 0.5, 0], rotate: [0, 0, 0.3], easing: 'smoothstep' },
  ] };
  const input = { parts: [{ ...part(), trajectory }], durationMs: 300 };
  const result = composeExpression(input);
  expect(result.body.children[0].parts[0].trajectory).toEqual(trajectory);
  expect(compile(result.body).kind).toBe('program');
  for (const keyframes of [trajectory.keyframes.slice(0, 1), [trajectory.keyframes[0],
    { ...trajectory.keyframes[1], translate: [4.1, 0, 0] }]]) {
    expect(() => composeExpression({ parts: [{ ...part(), trajectory: { ...trajectory, keyframes } }] })).toThrow('composition_arguments');
  }
});

const sharedTrack = () => ({ group: 'actor', pivot: [0, 0, 0], keyframes: [
  { atMs: 0, translate: [0, 0, 0], rotate: [0, 0, 0] },
  { atMs: 1200, translate: [1, 0.5, 0], rotate: [0, 0, 0.3], easing: 'smoothstep' },
] });
it('expands shared tracks to independent inline copies with identical compiled behavior', () => {
  const track = sharedTrack(), parts = [part(), { ...part(), id: 'second' }];
  const input = { tracks: [track], parts: parts.map(p => ({ ...p, trackRef: 'actor' })), durationMs: 300 };
  const before = structuredClone(input), shared = composeExpression(input);
  const inline = composeExpression({ parts: parts.map(p => ({ ...p, trajectory: track })), durationMs: 300 });
  expect(shared).toEqual(inline); expect(compile(shared.body)).toEqual(compile(inline.body)); expect(input).toEqual(before);
  shared.body.children[0].parts[0].trajectory.keyframes[0].translate[0] = 2;
  expect(shared.body.children[0].parts[1].trajectory.keyframes[0].translate[0]).toBe(0); expect(input).toEqual(before);
});
it('rejects duplicate, missing and conflicting track references without silently choosing a motion', () => {
  const track = sharedTrack(), referenced = { ...part(), trackRef: 'actor' };
  expect(() => composeExpression({ tracks: [track, track], parts: [referenced] })).toThrow('composition_track_duplicate');
  expect(() => composeExpression({ parts: [referenced] })).toThrow('composition_track_missing');
  expect(() => composeExpression({ tracks: [track], parts: [{ ...referenced, trackRef: 'unknown' }] })).toThrow('composition_track_missing');
  expect(() => composeExpression({ tracks: [track], parts: [{ ...referenced, trajectory: track }] })).toThrow('composition_track_conflict');
  const motion = { pivot: [0, 0, 0], translate: [0, 0, 0], rotate: [0, 0, 0], periodMs: 1000, phase: 0 };
  expect(() => composeExpression({ tracks: [track], parts: [{ ...referenced, motion }] })).toThrow('composition_track_conflict');
});
it('retains track array bounds and applies record size limits after shared expansion', () => {
  const track = sharedTrack();
  expect(() => composeExpression({ tracks: [], parts: [part()] })).toThrow('composition_arguments');
  expect(() => composeExpression({ tracks: Array.from({ length: 25 }, (_, i) => ({ ...track, group: `g${i}` })), parts: [part()] })).toThrow('composition_arguments');
  track.keyframes = Array.from({ length: 32 }, (_, i) => ({ atMs: i * 500, translate: [0, 0, 0], rotate: [0, 0, 0] }));
  const input = { tracks: [track], parts: Array.from({ length: 24 }, (_, i) => ({ ...part(), id: `p${i}`, trackRef: 'actor' })) };
  expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(32768);
  expect(() => composeExpression(input)).toThrow('composition_bytes');
});

it('advertises the actual minimum ellipsoid depth without weakening geometry validation', () => {
  const minimum = compositionSchema.$defs.part.anyOf.find(p => p.properties.kind.const === 'ellipsoid').properties.scale.items.minimum;
  expect(compositionTool.description).toContain(`at least ${minimum} on every axis`);
  expect(() => composeExpression({ parts: [{ ...part(), scale: [0.2, 0.2, minimum / 2] }] })).toThrow('composition_arguments');
  expect(() => composeExpression({ parts: [{ ...part(), scale: [0.2, 0.2, minimum] }] })).not.toThrow();
});


it('reports bounded precise shared-track validation paths without echoing invalid values', () => {
  const cases = [
    [track => { track.pivot[1] = 3; }, '/tracks/0/pivot/1', 'maximum', 2],
    [track => { track.keyframes[1].translate[0] = 5; }, '/tracks/0/keyframes/1/translate/0', 'maximum', 4],
    [track => { track.keyframes[1].easing = 'PRIVATE_INVALID'; }, '/tracks/0/keyframes/1/easing', 'enum', undefined],
  ];
  for (const [mutate, path, rule, limit] of cases) {
    const track = sharedTrack(); mutate(track); let failure;
    try { composeExpression({ tracks: [track], parts: [{ ...part(), trackRef: 'actor' }] }); }
    catch (error) { failure = error; }
    expect(failure?.message).toBe('composition_arguments');
    expect(failure?.details).toEqual([{ path, rule, ...(limit === undefined ? {} : { limit }) }]);
    expect(failure.details.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(failure.details)).not.toContain('PRIVATE_INVALID');
    expect(failure.details.every(detail => detail.path.length <= 160)).toBe(true);
  }
});

it('gives native authors the same trajectory units and timeline semantics as Live', () => {
  for (const phrase of ['shared rest-scene coordinates', 'absolute offset from rest', 'XYZ radians',
    'shortest path per axis', 'starts at 0 and strictly increases', 'assembly transition time',
    'playback starts after assembly', 'runs once and holds its endpoint', 'Motion-off pauses'])
    expect(nativeVisualAuthoringGuide).toContain(phrase);
});

it('emits only the new parts with explicit host-side append intent and no inferred current scene', () => {
  const input = { base: 'current_scene', parts: [part()], requestId: 'append-owned', expectedEpoch: 'test' };
  const before = structuredClone(input), result = composeExpression(input);
  expect(input).toEqual(before);
  expect(result).toMatchObject({ policy: 'replace', requestId: 'append-owned', expectedEpoch: 'test',
    body: { type: 'live', configuration: { sceneAppend: true, controls: [], poses: [] } } });
  expect(result.body.program.children).toEqual([{ type: 'assemble', parts: [part()], durationMs: 600, easing: 'smoothstep' }]);
  expect(composeExpression({ parts: [part()] })).toEqual(composeExpression({ base: 'none', parts: [part()] }));
  const explicit = composeExpression({ ...input, style: { color: '#123456' }, flow: { field: 'pulse', strength: 0.1 } });
  expect(explicit.body.configuration).toMatchObject({ sceneAppend: true });
  for (const authority of [{ transient: true }, { observerHandoffMs: 1000 }])
    expect(() => composeExpression({ ...input, ...authority })).toThrow('scene_append_ownership');
  expect(explicit.body.program.children.map(child => child.type)).toEqual(['assemble', 'style', 'flow']);
});

it('forwards current_scene intent through actual MCP without expanding remembered geometry', async () => {
  let forwarded;
  const server = createServer((req, res) => {
    if (req.url === '/v1/sessions') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 's', epoch: 'e' })); return; }
    if (req.method === 'DELETE') { res.writeHead(200).end('{}'); return; }
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { forwarded = JSON.parse(body); res.writeHead(500, { 'Content-Type': 'application/json' }).end('{}'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = liveTestClient(`http://127.0.0.1:${server.address().port}`, 'synthetic-append-only');
  try {
    await client.tool('compose_expression', { base: 'current_scene', parts: [part()] });
    expect(forwarded.body.configuration.sceneAppend).toBe(true);
    expect(forwarded.body.program.children[0].parts).toEqual([part()]);
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
}, 15000);

it('authors removal-only as a valid wait intent, never dummy geometry', () => {
  const input = { base: 'current_scene', parts: [], removePartIds: ['authored'], expectedSceneRevision: 4, expectedEpoch: 'test' };
  const value = composeExpression(input);
  expect(value.body.program.children).toEqual([{ type: 'wait', durationMs: 600 }]);
  expect(value.body.configuration).toMatchObject({ sceneAppend: true, sceneRemove: ['authored'], sceneRevision: 4 });
  expect(value.expectedEpoch).toBe('test'); expect(input.parts).toEqual([]);
});
it.each(['base', 'epoch', 'revision', 'duplicate', 'unknown-field', 'empty', 'revision-only'])('rejects ambiguous selective edits: %s', mode => {
  const input = { base: 'current_scene', parts: [], removePartIds: ['authored'], expectedSceneRevision: 4, expectedEpoch: 'test' };
  if (mode === 'base') input.base = 'none';
  if (mode === 'epoch') delete input.expectedEpoch;
  if (mode === 'revision') delete input.expectedSceneRevision;
  if (mode === 'duplicate') input.removePartIds.push('authored');
  if (mode === 'unknown-field') input.removeEverything = true;
  if (mode === 'empty') input.removePartIds = [];
  if (mode === 'revision-only') { delete input.removePartIds; input.parts = [part()]; }
  expect(() => composeExpression(input)).toThrow();
});

it('carries explicit removal easing without changing empty wait grammar', () => {
  const value = composeExpression({base:'current_scene',parts:[],removePartIds:['authored'],expectedEpoch:'test',expectedSceneRevision:1,easing:'linear'});
  expect(value.body.configuration.sceneEasing).toBe('linear');
  expect(value.body.program.children).toEqual([{type:'wait',durationMs:600}]);
});

it('keeps observer schemas free of MAIN-only edit fields and valid animation decisions', () => {
  const json=JSON.stringify(expressionResponseSchema);
  for(const key of ['sceneRemove','sceneRevision','sceneEasing','sceneAppend','removePartIds','expectedSceneRevision']) expect(json).not.toContain('"'+key+'"');
  expect(parseExpressionResponse(JSON.stringify({reply:'Hi',decision:{mode:'animate',reasonCode:'ack',payload:{controls:[],poses:[],lifetimeMs:1000}}}))).toMatchObject({mode:'animate',tool:'express'});
});
