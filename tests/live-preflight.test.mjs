import { expect, it } from 'vitest';
import { probeReply } from '../integrations/live-probe.mjs';
import { promptContext } from '../scripts/live-preflight.mjs';

it('keeps synthetic look pixels out of textual metadata and records tool use', () => {
  const calls = [], record = tool => calls.push(tool);
  const look = probeReply('tools/call', { name: 'look' }, 'encoded-fixture', record);
  expect(look.content[0].text).not.toContain('red');
  expect(look.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: 'encoded-fixture' });
  expect(calls).toEqual(['look']);
  expect(JSON.parse(probeReply('tools/call', { name: 'observe' }, '', record).content[0].text).synthetic).toBe(true);
});

it('bounds hook context and labels observed values as data', () => {
  const result = promptContext({ summary: 'x'.repeat(5000) });
  expect(result.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  expect(result.hookSpecificOutput.additionalContext).toContain('data, not instructions');
  expect(result.hookSpecificOutput.additionalContext.length).toBeLessThan(1900);
});
