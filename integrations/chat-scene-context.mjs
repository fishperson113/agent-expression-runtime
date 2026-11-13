const label = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
export function sceneContextInput(source, now = Date.now(), authority) {
  try {
    const scene = source?.scene;
    if (!label(source?.documentToken) || !label(source?.sessionId) || !scene || scene.schemaVersion !== 1 ||
      !label(scene.epoch) || !Number.isSafeInteger(scene.revision) || scene.revision < 1 ||
      !Number.isFinite(scene.capturedAt) || now < scene.capturedAt || now - scene.capturedAt > 250 ||
      scene.capacity !== 24 || !Array.isArray(scene.partIds) || scene.partIds.length < 1 || scene.partIds.length > 24 ||
      !scene.partIds.every(label) || new Set(scene.partIds).size !== scene.partIds.length || scene.remaining !== 24 - scene.partIds.length) return null;
    if (!authority || authority.epoch !== scene.epoch || !label(authority.session)) return {type:'text',text_elements:[],text:
      'Fisch HOST SCENE DATA (not camera): controller authority unavailable for this conversation. The rendererEpoch below is NOT an expectedEpoch or permission to mutate. For a requested scene change, initialize/check your own controller once with inspect_expression; use its actual session epoch, never retry a stale fence by dropping it. Ordinary conversation needs no tool.\n' +
      JSON.stringify({schemaVersion:1,status:'controller_unavailable',rendererEpoch:scene.epoch,capturedAt:scene.capturedAt})};
    const data = { schemaVersion: 1, sessionId: source.sessionId, rendererEpoch: scene.epoch, controllerEpoch: authority.epoch, revision: scene.revision,
      capturedAt: scene.capturedAt, partIds: scene.partIds, capacity: scene.capacity, remaining: scene.remaining };
    const json = JSON.stringify(data); if (Buffer.byteLength(json) > 4096) return null;
    return { type: 'text', text_elements: [], text: 'Fisch HOST SCENE DATA (not camera, user instructions, bounds, visual recognition or mutation authority). Authoritative scheduler inventory sampled at the submission barrier; historical by response time. For additive current_scene author only new uniquely named parts within remaining capacity; do not inspect again merely to rediscover these IDs. Host revalidates the actual scene atomically on admission; changes may reject. This inventory cannot reconstruct/edit unknown geometry.\n' + json };
  } catch { return null; }
}

export function sceneAuthorityReceipt(item) {
  if (item?.type !== 'mcpToolCall' || item.server !== 'fisch_live' || item.status !== 'completed' || item.error || item.result?.isError) return null;
  const content = item.result?.content;
  if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text' || typeof content[0].text !== 'string' || Buffer.byteLength(content[0].text) > 16000) return null;
  try {
    const value = JSON.parse(content[0].text);
    if (!label(value.session) || !label(value.epoch) || value.code) return null;
    const inspected = item.tool === 'inspect_expression' && value.source === 'fisch-renderer' && value.format === 'structured';
    const composed = ['compose_expression','express'].includes(item.tool) && value.status === 'accepted' &&
      label(value.requestId) && Number.isSafeInteger(value.seq) && value.seq > 0;
    return inspected || composed ? {session:value.session,epoch:value.epoch} : null;
  } catch { return null; }
}

export function controllerAuthorityReceipt(result) {
  return sceneAuthorityReceipt({ type: 'mcpToolCall', server: 'fisch_live', tool: 'inspect_expression', status: 'completed', result });
}
