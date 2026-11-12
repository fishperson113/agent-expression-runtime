import { readFileSync } from 'node:fs';
import { capabilityResource } from './capability-contract.mjs';

export function nativeLiveInstructions() {
  const instructions = readFileSync(new URL('./live-instructions.md', import.meta.url), 'utf8');
  const references = ['aer://capabilities/v1', 'aer://workflow/v1'].map(uri => {
    const resource = capabilityResource(uri).contents[0];
    return `${uri}\n${resource.text}`;
  });
  return instructions + '\n\n## Host-provided static references\n' +
    'The following are the exact capability and workflow resources from this installed Fisch host. They are already supplied for this thread, so do not fetch these same two resources or list resources merely to read them again. Use them directly for ordinary expression decisions; discover other tools/resources when needed. This is static reference data, NOT current scene, ownership, camera state or execution evidence. Continue observe and the usual state/feedback checks. If the connected tool contract differs, read its actual resources rather than assuming this snapshot applies.\n\n' + references.join('\n\n');
}
