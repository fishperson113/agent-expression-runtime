import { presentationBody } from './presentation-body.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function diagramIdentity(job) {
  return { documentId:job.documentId, threadId:job.threadId, turnId:job.turnId,
    generation:job.generation, messageId:job.messageId, textPrefix:job.checkpoint.textPrefix,
    publicRevision:job.publicRevision, section:job.section, sourceStart:job.sourceStart,
    sourceEnd:job.sourceEnd, sourceQuote:job.sourceQuote };
}
export function prepareDiagram(bridge, job) {
  clearTimeout(bridge.holdTimer);
  bridge.selected?.controller.abort();
  bridge.serial++;job.serial=bridge.serial;bridge.selected=job;bridge.pending=job;
  job.scene={partIds:[]};bridge.drain();
}
export async function awaitDiagramDwell(bridge, job) {
  const displayed=bridge.displayed;
  if(!displayed)return;
  while(bridge.valid(job)&&bridge.displayed===displayed&&bridge.now()<displayed.expiresAt) {
    const status=await bridge.evaluate(owned=>window.fischLive?.diagramPresentationStatus?.(owned),displayed.owned,job);
    if(!status?.current)return;
    if(status.visible&&Number.isFinite(status.visibleElapsedMs)&&status.visibleElapsedMs>=2500)return;
    if(!Number.isFinite(status.remainingMs)||status.remainingMs<=0)return;
    await sleep(Math.min(50,status.remainingMs,Math.max(1,bridge.remaining(job))));
  }
}
export async function applyPreparedDiagram(bridge, job, record) {
  if(!bridge.valid(job))return;
  if(record.mode==='retain'){bridge.emit('retain',{revision:job.checkpoint.checkpointRevision});return;}
  if(!record.diagram||record.mode!=='compose'||record.payload?.base!=='none')throw Error('diagram_prepared_absolute_required');
  await awaitDiagramDwell(bridge,job);
  if(!bridge.valid(job))return;
  const body=presentationBody(record,{});let receipt;
  while(bridge.valid(job)) {
    receipt=await bridge.evaluate(value=>window.fischLive?.applyPreparedDiagram?.(value),{
      identity:diagramIdentity(job),body,diagram:record.diagram,sentWall:Date.now(),
      expiresAt:job.expiresAt,monotonicDeadline:performance.timeOrigin+job.monotonicDeadline,remainingMs:bridge.remaining(job)
    },job,late=>{if(late?.status==='accepted'){bridge.emit('admitted_stale',{revision:job.checkpoint.checkpointRevision,sourceHash:job.sourceHash});void revokeDiagramReceipt(bridge,{epoch:late.epoch,sceneRevision:late.sceneRevision,seq:late.seq});}})
      .catch(error=>{bridge.emit('admission_unknown',{code:error.message,revision:job.checkpoint.checkpointRevision});throw error;});
    if(receipt?.code!=='presentation_busy')break;
    await sleep(50);
  }
  const accepted=receipt?.status==='accepted',current=bridge.valid(job);
  if(accepted&&current){job.admitted=true;job.displayedOwned={epoch:receipt.epoch,sceneRevision:receipt.sceneRevision,seq:receipt.seq};bridge.displayed={expiresAt:job.expiresAt,owned:job.displayedOwned};}else if(accepted)await revokeDiagramReceipt(bridge,{epoch:receipt.epoch,sceneRevision:receipt.sceneRevision,seq:receipt.seq});
  bridge.emit(accepted?(current?'admitted':'admitted_stale'):'drop',{code:receipt?.code,revision:job.checkpoint.checkpointRevision,
    sourceAt:job.sourceAt,publishedAt:job.checkpoint.observedAt,lagMs:bridge.now()-job.checkpoint.observedAt,sourceHash:job.sourceHash});
}
export async function revokeDiagramReceipt(bridge,owned) {
  if(!owned)return;
  await bridge.evaluate(value=>{
    const api=window.fischLive,status=api?.diagramLabStatus?.();
    if(status?.current===true&&status?.owned&&['epoch','sceneRevision','seq'].every(key=>status.owned[key]===value[key]))api.revokePresentation?.();
  },owned).catch(()=>{});
  if(bridge.displayed?.owned===owned)bridge.displayed=null;
}
