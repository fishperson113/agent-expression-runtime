import { compositionTool } from './compose-expression.mjs';
import { liveToolDefinitions } from './live-tools.mjs';
import { expressionStatusTool } from './expression-status.mjs';
import { readFileSync } from 'node:fs';
import { capabilityResource } from './capability-contract.mjs';

export function nativeLiveInstructions() {
  const instructions = readFileSync(new URL('./live-instructions.md', import.meta.url), 'utf8');
  const references = ['aer://capabilities/v1', 'aer://workflow/v1'].map(uri => {
    const resource = capabilityResource(uri).contents[0];
    return `${uri}\n${resource.text}`;
  });
  return instructions + '\n\n## Host-provided static references\n' +
    'The following are the exact capability and workflow resources from this installed Fisch host. They are already supplied for this thread, so do not fetch these same two resources or list resources merely to read them again. Use them directly for ordinary expression decisions; discover other tools/resources when needed. This is static reference data, NOT current scene, ownership, camera state or execution evidence. Use the actual image attached to this user message when present, without an observe prerequisite; keep necessary geometry inspection and execution feedback checks. Observe remains a separate geometric/coordination diagnostic, not image retrieval. If the connected tool contract differs, read its actual resources rather than assuming this snapshot applies.\n\n' + references.join('\n\n') + nativeToolManifest();
}

export function nativeToolManifest() {
  const manifest = [compositionTool, liveToolDefinitions().find(tool => tool.name === 'inspect_expression'), expressionStatusTool]
    .map(tool => ({ ...tool, callable: 'tools.mcp__fisch_live__' + tool.name }));
  return '\n\n## Installed Fisch tool manifest\n' +
    'These exact descriptors and JSON input schemas are generated from the installed host tool definitions. Use these callable names directly in functions.exec when needed; no discovery or second declaration lookup is necessary for these three already supplied tools. Do not print or fetch their descriptions again merely to learn the schema. All other tools remain discoverable when needed. These are static reference data, not current state or authority: keep required geometry/state inspection, expectedEpoch checks and feedback handling; do not invent missing state. If actual contract mismatches, discover the actual contract.\n' + JSON.stringify(manifest);
}
