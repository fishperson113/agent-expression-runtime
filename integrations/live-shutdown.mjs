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
