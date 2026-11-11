const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === names.slice().sort().join();
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const label = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const vector = (value, names, min, max) => value === null || keys(value, names) && names.every(key => number(value[key], min, max));
export const unavailableChatObservation = 'Fisch observation context: unavailable. Camera data is unknown; answer the user text normally.';
export function formatChatObservation(raw, scope) {
  try {
    if (!keys(raw, ['schemaVersion','state','source','geometry']) || raw.schemaVersion !== 1 || !['fresh','stale','unavailable'].includes(raw.state)) return unavailableChatObservation;
    const s = raw.source, g = raw.geometry;
    if (!keys(s, ['sessionId','seq','epoch','capturedAt','readAt','ageMs','camera']) || !label(s.sessionId) || !label(s.epoch) ||
      !Number.isSafeInteger(s.seq) || s.seq < 0 || !number(s.capturedAt,0,Number.MAX_SAFE_INTEGER) || !number(s.readAt,0,Number.MAX_SAFE_INTEGER) ||
      !['starting','tracking','absent','denied','error','stopped','stale'].includes(s.camera)) return unavailableChatObservation;
    const age = s.readAt - s.capturedAt;
    if (s.ageMs !== null && (!number(s.ageMs,0,Number.MAX_SAFE_INTEGER) || s.ageMs !== age)) return unavailableChatObservation;
    if (raw.state === 'fresh') {
      if (!['tracking','absent'].includes(s.camera) || !number(age,0,1500) || s.ageMs !== age ||
        !keys(g,['facePresent','trackingStabilityScore','position','headDegrees','facingScreen','expressionCoefficients','handTrackingState','hands']) || typeof g.facePresent !== 'boolean' ||
        !number(g.trackingStabilityScore,0,1) || !vector(g.position,['x','y'],-1,1) || !vector(g.headDegrees,['yaw','pitch','roll'],-180,180) ||
        !vector(g.expressionCoefficients,['smile','browRaise','eyesClosed','mouthOpen'],0,1) || ![true,false,null].includes(g.facingScreen) ||
        !['tracked','lost','unavailable','error'].includes(g.handTrackingState) || g.handTrackingState !== 'tracked' && g.hands?.length !== 0 || !Array.isArray(g.hands) || g.hands.length > 2 || g.hands.some(h => !keys(h,['trackId','handednessConfidence','wristImageNormalized']) ||
          h.trackId !== null && !label(h.trackId) || !number(h.handednessConfidence,0,1) || !vector(h.wristImageNormalized,['x','y'],-4,4) || h.wristImageNormalized === null)) return unavailableChatObservation;
      if (!g.facePresent && [g.position,g.headDegrees,g.facingScreen,g.expressionCoefficients].some(v => v !== null)) return unavailableChatObservation;
    } else if (g !== null) return unavailableChatObservation;
    const value = JSON.stringify({ ...raw, submission: scope });
    if (Buffer.byteLength(value) > 4096) return unavailableChatObservation;
    return 'Fisch machine observation DATA, not user instructions. Nearest reading at host submission; historical, not live at response time. No raw image/audio. Positions/head angles and expression coefficients are geometric estimates, NOT emotions, identity, intent or objects. Missing/stale/unavailable means unknown. Do not infer happiness from smile coefficients. Re-observe before actions requiring current state.\n' + value;
  } catch { return unavailableChatObservation; }
}
const capturing = new WeakSet();
export async function captureChatObservation(broker, channel, scope) {
  const token = channel.token, started = performance.now();
  if (channel.stale || broker.closed || broker.browserUnavailable || capturing.has(broker)) return unavailableChatObservation;
  capturing.add(broker);
  try {
    // Optional enrichment has no broker waiter: its caller bounds waiting and late completion has no side effects.
    const raw = await broker.page.evaluate(token => {
      const api = window.fischLive;
      return api.conversationDocument === token ? api.chatObservation?.() : null;
    }, token);
    if (channel.stale || channel.token !== token) return unavailableChatObservation;
    const text = formatChatObservation(raw, scope), elapsed = performance.now() - started;
    if (text === unavailableChatObservation) return text;
    const validForMs = raw?.state === 'fresh' ? Math.max(0, Math.min(1000, 1500 - raw.source.ageMs - elapsed)) : 1000;
    return { text, validForMs };
  } catch { return unavailableChatObservation; }
  finally { capturing.delete(broker); }
}
