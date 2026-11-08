import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../src/contracts/live-control.schema.json', import.meta.url), 'utf8'));
const observationSchema = JSON.parse(readFileSync(new URL('../src/contracts/live.schema.json', import.meta.url), 'utf8'));
const capabilities = JSON.parse(readFileSync(new URL('../src/contracts/capabilities.json', import.meta.url), 'utf8')).live;
export function liveInputSchema(legacy) {
  const copy = structuredClone(legacy), renamed = JSON.parse(JSON.stringify(schema).replaceAll('#/$defs/', '#/$defs/live_'));
  Object.assign(copy.$defs, Object.fromEntries(Object.entries(renamed.$defs).map(([key, value]) => ['live_' + key, value])));
  const { $schema, $defs, ...node } = renamed;
  copy.properties.body.anyOf.push(node); return copy;
}
export function liveToolDefinitions() {
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  return [{ name: 'observe', description: 'Read current local face observations and events since your last read. Call at the start of every turn; stale/unknown is not absence. No image.', annotations,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'look', description: 'Look at a SYNTHETIC visual fixture only. Camera pixels are never sent. Visible reason, five-second cooldown.', annotations,
    inputSchema: { type: 'object', properties: { reason: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['reason'], additionalProperties: false } }];
}
export function liveResource() { return { capabilities, observationSchema, controlSchema: schema }; }
export function createLiveTools(request, currentSession, resetSession = () => {}) {
  let cursor = 0, sessionId;
  return async (name, args = {}) => {
    try {
      if (!['observe', 'look'].includes(name)) throw Error('unknown_tool');
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => name === 'observe' || key !== 'reason')) throw Error('invalid_arguments');
      if (name === 'look' && (typeof args.reason !== 'string' || !args.reason.length || args.reason.length > 120 || /[\x00-\x1f]/.test(args.reason))) throw Error('look_reason');
      const session = await currentSession();
      if (session.id !== sessionId) { sessionId = session.id; cursor = 0; }
      const path = `/v1/sessions/${session.id}`;
      const result = name === 'observe' ? await request(path + '/observe?cursor=' + cursor) : await request(path + '/look', args, 'POST', 3000);
      if (name === 'observe') { cursor = result.cursor; return { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
      if (result.synthetic !== true || result.mimeType !== 'image/jpeg' || typeof result.data !== 'string' || result.data.length > 220000) throw Error('look_result_invalid');
      return { content: [{ type: 'text', text: 'Synthetic fixture only; not a camera image. Reason: ' + args.reason },
        { type: 'image', mimeType: 'image/jpeg', data: result.data }] };
    } catch (error) {
      if (['session_closed', 'session', 'http_404'].includes(error.message)) resetSession();
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', code: error.message }) }] };
    }
  };
}
