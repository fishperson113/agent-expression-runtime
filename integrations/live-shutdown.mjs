const owned = Symbol('live_shutdown');
const codes = Object.freeze({ ui: 0, abort: 130, failure: 1, cleanup: 1 });

export function liveShutdown(kind) {
  return Object.freeze({ [owned]: true, code: codes[kind] ?? 1 });
}
export function liveShutdownCode(reason) {
  return reason?.[owned] === true ? reason.code : undefined;
}
export async function closeLiveOwned(actions, hasPrimaryError = false) {
  const results = await Promise.allSettled(actions.map(action => Promise.resolve().then(action)));
  if (!hasPrimaryError && results.some(result => result.status === 'rejected')) throw Error('live_cleanup_failed');
}

// Unlike event delivery, shutdown must preserve and join visual settlement.
// Invoke immediately so cancellation is synchronous; observe rejection even when
// an abort callback cannot await it. Repeated cleanup paths join the same promise.
const presentationClosures = new WeakMap();
export function closePresentation(state) {
  if (presentationClosures.has(state)) return presentationClosures.get(state);
  const done = Promise.withResolvers();
  presentationClosures.set(state, done.promise); done.promise.catch(() => {});
  try { Promise.resolve(state.presentation?.close()).then(done.resolve, done.reject); }
  catch (error) { done.reject(error); }
  return done.promise;
}
