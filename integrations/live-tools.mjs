import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../src/contracts/live-control.schema.json', import.meta.url), 'utf8'));
const observationSchema = JSON.parse(readFileSync(new URL('../src/contracts/live.schema.json', import.meta.url), 'utf8'));
const capabilities = JSON.parse(readFileSync(new URL('../src/contracts/capabilities.json', import.meta.url), 'utf8')).live;
const face = JSON.parse(readFileSync(new URL('../src/core/live/face.json', import.meta.url), 'utf8'));
export function restingFaceExpression() {
  return { type: 'live', program: { type: 'parallel', children: [
    { type: 'assemble', parts: structuredClone(face.parts), durationMs: 600 },
    { type: 'flow', field: 'pulse', strength: 0, durationMs: 600 },
    { type: 'style', pointSize: 1.8, brightness: 0.85, dispersion: 0, durationMs: 600 },
  ] }, configuration: { controls: [], poses: [], lifetimeMs: 60000 } };
}
export function liveInputSchema(legacy) {
  const copy = structuredClone(legacy), renamed = JSON.parse(JSON.stringify(schema).replaceAll('#/$defs/', '#/$defs/live_'));
  Object.assign(copy.$defs, Object.fromEntries(Object.entries(renamed.$defs).map(([key, value]) => ['live_' + key, value])));
  const { $schema, $defs, ...node } = renamed;
  copy.properties.body.anyOf.push(node); return copy;
}
export function liveToolDefinitions() {
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  return [{ name: 'return_to_face', description: 'Restore the declared resting face after an illustration, clearing semantic controls. For face gestures use express with live poses targeting eye_left, eye_right, brow_left, brow_right or mouth; choose bounded transforms yourself.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'observe', description: 'Read current local face observations and events since your last read. Call at the start of every turn; stale/unknown is not absence. No image. Includes best-effort fresh host coordination separately: public Fisch replies/brief and ownership, never private MAIN transcript. Historical replies are not current geometry. Unavailable coordination has a bounded reasonCode and monotonic elapsedMs (rounded, saturated at 60000); no cached state.', annotations,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'inspect_expression', description: 'Refresh a structured summary from the engine renderer only: last submitted particle-buffer bounds, part IDs/types and style, with frame/epoch provenance. No camera or image. This is not pixel/recognition/vision evidence. Unavailable while frozen, backgrounded or disconnected. One request per second.', annotations,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'preview_expression', description: 'View an actual PNG of the generated expression canvas only, with metadata from the same rendered frame. No camera, screen, chat or DOM. At most480 pixels/160KiB. Current rendered frame, not proof of latest compose revision or animation quality. Unavailable when frozen, hidden, cancelled or disconnected; shares one-request/second limit with inspect/observe. No automatic retries.', annotations,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'look', description: 'Look at a SYNTHETIC visual fixture only. Camera pixels are never sent. Visible reason, five-second cooldown.', annotations,
    inputSchema: { type: 'object', properties: { reason: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['reason'], additionalProperties: false } }];
}
export function liveResource() { return { capabilities, observationSchema, controlSchema: schema, restingFace: face }; }
function coordinationFailure(error) {
  if (['TimeoutError', 'AbortError'].includes(error?.name) || ['render_refresh_unavailable', 'http_504'].includes(error?.message)) return 'timeout';
  if (['render_rate_limited', 'http_429'].includes(error?.message)) return 'rate_limited';
  if (['render_epoch_changed', 'stale_epoch'].includes(error?.message)) return 'epoch_changed';
  if (['live_disconnected', 'session_closed', 'session', 'http_404'].includes(error?.message) || error?.name === 'TypeError' && error?.message === 'fetch failed') return 'disconnected';
  if (error?.message === 'invalid_gateway_response') return 'invalid_response';
  return 'request_failed';
}
async function readCoordination(request, currentSession, resetSession, path, session) {
  const started = performance.now();
  let value = { schemaVersion: 1, source: 'fisch-host', available: false, reasonCode: 'refresh_unavailable' };
  if (typeof session.epoch === 'string') try {
    const refreshed = await request(path + '/render-output', { coordinationOnly: true }, 'POST', 750), current = await currentSession();
    if (!refreshed || typeof refreshed !== 'object' || typeof refreshed.session !== 'string' || typeof refreshed.epoch !== 'string') value.reasonCode = 'invalid_response';
    else if (current.id !== session.id || current.epoch !== session.epoch || refreshed.session !== session.id || refreshed.epoch !== session.epoch) value.reasonCode = 'epoch_changed';
    else if (refreshed.schemaVersion !== 1 || refreshed.source !== 'fisch-renderer' || refreshed.format !== 'structured'
      || refreshed.coordination?.schemaVersion !== 1 || refreshed.coordination?.source !== 'fisch-host') value.reasonCode = 'invalid_response';
    else if (refreshed.coordination.available !== true) value.reasonCode = 'refresh_unavailable';
    else if (refreshed.coordination.session !== session.id || refreshed.coordination.epoch !== session.epoch) value.reasonCode = 'epoch_changed';
    else value = refreshed.coordination;
  } catch (error) {
    value.reasonCode = coordinationFailure(error);
    if (['session_closed', 'session', 'http_404'].includes(error?.message)) resetSession();
  }
  return { ...value, elapsedMs: Math.min(60000, Math.max(0, Math.round(performance.now() - started))) };
}
async function previewExpression(request, currentSession, path, session) {
  const result = await request(path + '/render-output', { preview: true }, 'POST', 3000);
  const image = result?.image;
  if (result?.source !== 'fisch-renderer' || result.format !== 'image' || result.session !== session.id || result.epoch !== session.epoch ||
      image?.mimeType !== 'image/png' || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 480 || image.height > 480 ||
      typeof image.data !== 'string' || image.data.length > 218456 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw Error('render_output_invalid');
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.length > 163840 || bytes.length !== image.bytes || bytes.length < 24 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.toString('ascii',12,16) !== 'IHDR' || bytes.readUInt32BE(16) !== image.width || bytes.readUInt32BE(20) !== image.height) throw Error('render_output_invalid');
  const current = await currentSession();
  if (current.id !== session.id || current.epoch !== result.epoch) throw Error('render_epoch_changed');
  const metadata = Object.fromEntries(['schemaVersion', 'source', 'format', 'session', 'epoch', 'requestId', 'receivedAt', 'summary', 'evidence'].map(key => [key, result[key]]));
  return { content: [{ type: 'text', text: JSON.stringify(metadata) }, { type: 'image', mimeType: 'image/png', data: image.data }] };
}
export function createLiveTools(request, currentSession, resetSession = () => {}) {
  let cursor = 0, sessionId;
  return async (name, args = {}) => {
    try {
      if (!['observe', 'look', 'inspect_expression', 'preview_expression'].includes(name)) throw Error('unknown_tool');
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => name !== 'look' || key !== 'reason')) throw Error('invalid_arguments');
      if (name === 'look' && (typeof args.reason !== 'string' || !args.reason.length || args.reason.length > 120 || /[\x00-\x1f]/.test(args.reason))) throw Error('look_reason');
      const session = await currentSession();
      if (session.id !== sessionId) { sessionId = session.id; cursor = 0; }
      const path = `/v1/sessions/${session.id}`;
      if (name === 'preview_expression') return await previewExpression(request, currentSession, path, session);
      if (name === 'inspect_expression') {
        const result = await request(path + '/render-output', {}, 'POST', 3000);
        if (result.source !== 'fisch-renderer' || result.format !== 'structured' || result.session !== session.id || result.epoch !== session.epoch) throw Error('render_output_invalid');
        const current = await currentSession();
        if (current.id !== session.id || current.epoch !== result.epoch) throw Error('render_epoch_changed');
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      const result = name === 'observe' ? await request(path + '/observe?cursor=' + cursor) : await request(path + '/look', args, 'POST', 3000);
      if (name === 'observe') {
        cursor = result.cursor;
        const coordination = await readCoordination(request, currentSession, resetSession, path, session);
        return { content: [{ type: 'text', text: JSON.stringify({ ...result, coordination }) }] };
      }
      if (result.synthetic !== true || result.mimeType !== 'image/jpeg' || typeof result.data !== 'string' || result.data.length > 220000) throw Error('look_result_invalid');
      return { content: [{ type: 'text', text: 'Synthetic fixture only; not a camera image. Reason: ' + args.reason },
        { type: 'image', mimeType: 'image/jpeg', data: result.data }] };
    } catch (error) {
      if (['session_closed', 'session', 'http_404'].includes(error.message)) resetSession();
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', code: error.message }) }] };
    }
  };
}
