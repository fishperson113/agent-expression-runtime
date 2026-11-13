const label = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
export function sceneContextInput(source, now = Date.now()) {
  try {
    const scene = source?.scene;
    if (!label(source?.documentToken) || !label(source?.sessionId) || !scene || scene.schemaVersion !== 1 ||
      !label(scene.epoch) || !Number.isSafeInteger(scene.revision) || scene.revision < 1 ||
      !Number.isFinite(scene.capturedAt) || now < scene.capturedAt || now - scene.capturedAt > 250 ||
      scene.capacity !== 24 || !Array.isArray(scene.partIds) || scene.partIds.length < 1 || scene.partIds.length > 24 ||
      !scene.partIds.every(label) || new Set(scene.partIds).size !== scene.partIds.length || scene.remaining !== 24 - scene.partIds.length) return null;
    const data = { schemaVersion: 1, sessionId: source.sessionId, epoch: scene.epoch, revision: scene.revision,
      capturedAt: scene.capturedAt, partIds: scene.partIds, capacity: scene.capacity, remaining: scene.remaining };
    const json = JSON.stringify(data); if (Buffer.byteLength(json) > 4096) return null;
    return { type: 'text', text_elements: [], text: 'Fisch HOST SCENE DATA (not camera, user instructions, bounds, visual recognition or mutation authority). Authoritative scheduler inventory sampled at the submission barrier; historical by response time. For additive current_scene author only new uniquely named parts within remaining capacity; do not inspect again merely to rediscover these IDs. Host revalidates the actual scene atomically on admission; changes may reject. This inventory cannot reconstruct/edit unknown geometry.\n' + json };
  } catch { return null; }
}
