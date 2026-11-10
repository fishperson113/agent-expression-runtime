import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { expect, it } from 'vitest';
import { liveTestClient } from '../integrations/live-test-client.mjs';
import { capabilityResource, capabilityResourceList } from '../integrations/capability-contract.mjs';

const manifest = JSON.parse(readFileSync(new URL('../src/contracts/capabilities.json', import.meta.url), 'utf8'));
const read = async (client, uri) => {
  const result = await client.call('resources/read', { uri });
  expect(result.contents[0].uri).toBe(uri);
  return result.contents[0];
};
it('discovers complete expression contracts over actual stdio without camera, model or controller connection', async () => {
  const client = liveTestClient('http://127.0.0.1:1', 'synthetic-discovery-only');
  try {
    const initialized = await client.call('initialize');
    const { resources } = await client.call('resources/list');
    expect(resources.every(resource => resource.description?.length > 0)).toBe(true);
    for (const resource of resources) expect((await read(client, resource.uri)).mimeType).toBe(resource.mimeType);
    const caps = JSON.parse((await read(client, resources.find(r => r.name.includes('capabilities')).uri)).text);
    expect(caps).toEqual(manifest); expect(caps.nodes).toContain('style'); expect(caps.limits.queue).toBe(8);
    const workflow = JSON.parse((await read(client, resources.find(r => r.name.includes('workflow')).uri)).text);
    expect(workflow.schemaVersion).toBe(1);
    expect(workflow.evidence.accepted).toContain('not application');
    expect(workflow.evidence.statusTool).toContain('expression_status');
    expect(workflow.evidence.frame).toContain('not pixel visibility');
    expect(workflow.recovery.unknown).toContain('Do not automatically replay');
    expect(workflow.observation.boundary).toContain('must not pretend to know the task');
    expect(initialized.instructions).toContain('resources/list');
    expect(initialized.instructions).toContain('aer://workflow/v1');
  } finally { await client.close(); }
});
it('lets a consumer author free RGB and motion from the discovered tool schema, not fixed emotion tags', async () => {
  const client = liveTestClient('http://127.0.0.1:1', 'synthetic-schema-only');
  try {
    await client.call('initialize'); const { tools } = await client.call('tools/list');
    const express = tools.find(tool => tool.name === 'express');
    const validate = new Ajv({ strict: false }).compile(express.inputSchema);
    for (const color of ['#000000', '#FFFFFF', '#a237c9', '#1c73a9', '#E7a30B']) {
      expect(validate({ body: { type: 'parallel', children: [
        { type: 'style', color, durationMs: 500 }, { type: 'flow', field: 'orbit', strength: 0.2, durationMs: 500 },
      ] }, policy: 'replace' })).toBe(true);
    }
    expect(validate({ body: { type: 'emotion', label: 'happy' } })).toBe(false);
    expect(validate({ body: { type: 'style', color: 'url(javascript:bad)', durationMs: 500 } })).toBe(false);
    const instructions = (await read(client, 'aer://instructions/v1')).text;
    expect(instructions).toContain('#RRGGBB'); expect(instructions).toContain('không bị khóa');
  } finally { await client.close(); }
});
it('returns isolated manifest copies and rejects unknown resource names', () => {
  const listed = capabilityResourceList(); listed[0].uri = 'forged';
  expect(capabilityResourceList()[0].uri).toBe('aer://capabilities/v1');
  const first = JSON.parse(capabilityResource('aer://capabilities/v1').contents[0].text); first.limits.queue = 999;
  expect(JSON.parse(capabilityResource('aer://capabilities/v1').contents[0].text).limits.queue).toBe(8);
  expect(capabilityResource('aer://unknown/v1')).toBeUndefined();
});
