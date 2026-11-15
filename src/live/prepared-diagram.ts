const keys=['epoch','sceneRevision','seq'];
export function preparedDiagramIdentity(value:any,wall=Date.now(),mono=performance.timeOrigin+performance.now()) {
  const remaining=Math.min(value?.remainingMs,value?.expiresAt-wall,value?.monotonicDeadline-mono);
  if(!Number.isFinite(wall)||!Number.isFinite(mono)||!Number.isFinite(value?.sentWall)||wall<value.sentWall||!Number.isFinite(remaining)||remaining<=0)return null;
  return {...value.identity,remainingTtlMs:Math.min(10000,remaining)};
}
export function matchingDiagramStatus(owned:any,status:any) {
  if(!owned||!status?.current||!status.owned||keys.some(key=>owned[key]!==status.owned[key]))return {current:false};
  return {current:true,visible:status.visible===true,visibleElapsedMs:status.visibleElapsedMs,remainingMs:status.remainingMs};
}
