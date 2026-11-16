// Only complete compose output is independent of a retired inventory.
export function independentReplacement(body: any): boolean {
  return body?.type==='parallel' && Array.isArray(body.children) && body.children.length>=1 && body.children.length<=3 &&
    body.children[0]?.type==='assemble' && Array.isArray(body.children[0].parts) && body.children[0].parts.length>0 &&
    body.children.slice(1).every((child:any)=>child && ['style','flow'].includes(child.type));
}
