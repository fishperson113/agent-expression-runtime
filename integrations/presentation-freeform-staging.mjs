// Candidate cleanup is scoped: it must not revoke a newer accepted scene.
export async function cancelFreeformCandidate(bridge,job) {
  if(!job.scene?.scope)return;
  await bridge.evaluate(scope=>window.fischLive?.cancelPreparedPresentation?.(scope),job.scene.scope).catch(()=>{});
}
export async function revokeFreeformReceipt(bridge,receipt) {
  if(!receipt || typeof receipt.epoch!=='string' || !Number.isSafeInteger(receipt.sceneRevision) || !Number.isSafeInteger(receipt.seq))return;
  const owned={epoch:receipt.epoch,sceneRevision:receipt.sceneRevision,seq:receipt.seq};
  await bridge.evaluate(value=>window.fischLive?.revokeOwnedPresentation?.(value),owned).catch(()=>{});
}
