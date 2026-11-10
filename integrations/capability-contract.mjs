import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../src/contracts/capabilities.json', import.meta.url), 'utf8'));
const workflow = {
  schemaVersion: 1,
  role: 'Fisch is an expression capability. The external agent owns conversation, task context, memory and input/voice.',
  authoring: {
    schemaResource: 'aer://schema/v1', instructionsResource: 'aer://instructions/v1',
    choice: 'Author geometry, motion and any #RRGGBB color from actual context; no fixed emotion, phrase or gesture-to-effect table is required.',
    legibility: 'When two expressions should read differently at a glance, choose context-appropriate differences in silhouette, spatial arrangement, pose amplitude or timing; RGB is also freely authored. No fixed mapping is prescribed. Tiny eye/mouth changes alone may be hard to distinguish.',
    input: 'Declarative data only: no executable code, shaders, filesystem, network or per-frame commands.',
  },
  evidence: {
    statusTool: 'When tools/list advertises expression_status, expression_status({requestId}) reads feedback for your own submitted command; it does not create/reconnect a session or replay work. Unknown or unavailable feedback is not successful execution.',
    pending: 'Admission is unresolved. It is neither rejection nor acceptance.',
    accepted: 'Validation and admission succeeded. This is not application, animation completion or visible output.',
    applied: 'Execution/application evidence is separate from the admission receipt.',
    frame: 'A submitted frame or state hash is a rendering proxy, not pixel visibility or human interpretation.',
    visible: 'Raster/pixel evidence and human relevance are separate checks. Do not infer either from accepted or completed.',
    selfInspection: 'There is no agent tool for reading the actual rendered body image in this build. look returns a synthetic observation fixture, not the body canvas. A submitted AST, part name, scene goal or completed receipt cannot establish what a viewer recognizes. Do not claim that you visually checked the body.',
    canceled: 'Ownership was revoked; provider transport may still be running. Late results must not regain control.',
  },
  ownership: {
    replace: 'Use replace for a new intent; replacement starts from the displayed state.',
    append: 'Use append only for deliberate ordered choreography within the bounded queue.',
    leases: 'Live controls expire and return toward neutral/lower layers; user motion-off and stop remain authoritative.',
    scenePersistence: 'express controls the current body without a saved-creation journal or persistence guarantee across stop/reset; geometry may remain after program completion until another mutation. playground_state with includeScene=true returns a session-local authored scene clone, not a screenshot or proof of the current body. Conversation memory is not rendered scene state. Stop/reset/session or epoch changes can return the body to the resting face and invalidate playground ownership. Do not silently replay a remembered scene; inspect playground_state and honor recoveryRequired. recover clears history rather than restoring it. A new creation requires explicit fresh user intent.',
    restore: 'return_to_face restores the declared resting body and clears semantic controls; it is not an emotion preset.',
  },
  recovery: {
    cancel: 'cancel_expression requests cancellation of body work while keeping the agent running. A cancel ACK alone is not proof of renderer cancellation; feedback may remain unknown/cancel_acknowledged. Stop All closes the Live session and may close its owned Native UI.',
    unknown: 'Timeout/disconnection is not evidence that nothing ran. Do not automatically replay under a fresh request ID.',
    restart: 'Session/epoch loss invalidates old work. Resume with explicit new intent; acknowledged macro restoration does not replay uncertain animations.',
    content: 'Continue ordinary agent content when expression fails. Correct at most once when a specific rejection explains the correction; never loop retries.',
  },
  observation: {
    optional: 'Camera and classifiers are optional; neither is required for expression tool discovery or ordinary external-agent input.',
    boundary: 'The Native agent may use its own task context. The separate camera observer has typed observations only and must not pretend to know the task.',
    uncertainty: 'Unavailable/stale/null is unknown, not measured absence; geometry is not proof of emotion or intent.',
    privacy: 'No real camera pixels are supplied by look. Do not enable capture or new voice services implicitly.',
  },
};

const resources = [
  { uri: 'aer://capabilities/v1', name: 'Expression capabilities and limits v1', mimeType: 'application/json',
    description: 'Actual shared manifest: supported primitives, continuous controls, shapes and bounded runtime limits. No model or camera required.' },
  { uri: 'aer://workflow/v1', name: 'Expression ownership and feedback workflow v1', mimeType: 'application/json',
    description: 'How to author expressions and distinguish admission, execution, rendering, cancellation and recovery; no fixed emotion palette.' },
];
export function capabilityResourceList() { return structuredClone(resources); }
export function capabilityResource(uri) {
  const value = uri === resources[0].uri ? manifest : uri === resources[1].uri ? workflow : undefined;
  return value === undefined ? undefined : { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value) }] };
}
