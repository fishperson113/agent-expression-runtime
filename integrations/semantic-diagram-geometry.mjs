import { composeExpression } from './compose-expression.mjs';
const fail=()=>{throw Error('diagram_geometry_plan');};
const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
export const diagramPointToWorld=([x,y])=>[2*x-1,1-2*y,0];
const curve=(id,a,b)=>({id,kind:'curve',points:[diagramPointToWorld(a),diagramPointToWorld(b)],radius:.008,color:'#70b7ff'});
function rectangle(n,index) {
  if (![n.x,n.y,n.width,n.height].every(unit)||n.width<=0||n.height<=0)fail();
  const left=n.x-n.width/2,right=n.x+n.width/2,top=n.y-n.height/2,bottom=n.y+n.height/2;
  if (![left,right,top,bottom].every(unit))fail();
  const corners=[[left,top],[right,top],[right,bottom],[left,bottom]];
  return corners.map((p,i)=>curve(`dn${index}s${i}`,p,corners[(i+1)%4]));
}
function edgeParts(edge,index) {
  if (!['none','forward'].includes(edge.direction)||!Array.isArray(edge.line)||edge.line.length!==2
    ||edge.line.some(p=>!Array.isArray(p)||p.length!==2||!p.every(unit)))fail();
  const [a,b]=edge.line,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  if(length<.001)fail();
  const parts=[curve(`de${index}s0`,a,b)];
  if(edge.direction==='none')return parts;
  const head=Math.min(.025,length/3),ux=dx/length,uy=dy/length;
  for(const side of [-1,1]) {
    const end=[b[0]-head*ux+side*head*.5*uy,b[1]-head*uy-side*head*.5*ux];
    if(!end.every(unit))fail();
    parts.push(curve(`de${index}s${parts.length}`,b,end));
  }
  return parts;
}
/** Diagram geometry only. Labels/caption must use the same fixed orthographic plane. */
export function compileDiagramGeometry(plan) {
  if(plan?.version!==1||plan.projection!=='normalized-diagram-plane'
    ||!Array.isArray(plan.nodes)||plan.nodes.length<1||plan.nodes.length>4
    ||!Array.isArray(plan.edges)||plan.edges.length>2)fail();
  const ids=plan.nodes.map(n=>n.id), edgeIds=plan.edges.map(e=>e.id);
  const validId=s=>typeof s==='string'&&/^[a-z][a-z0-9_-]{0,31}$/u.test(s);
  if(ids.some(n=>!validId(n))||edgeIds.some(e=>!validId(e))||new Set(ids).size!==ids.length
    ||new Set(edgeIds).size!==edgeIds.length||plan.edges.some(e=>!ids.includes(e.from)||!ids.includes(e.to)||e.from===e.to))fail();
  const nodeGroups=plan.nodes.map(rectangle),edgeGroups=plan.edges.map(edgeParts);
  const parts=[...nodeGroups.flat(),...edgeGroups.flat()];
  const payload={base:'none',parts,durationMs:120};
  const compiled=composeExpression(payload);
  return {payload,compiled,nodeParts:Object.fromEntries(ids.map((id,i)=>[id,nodeGroups[i].map(p=>p.id)])),
    edgeParts:Object.fromEntries(edgeIds.map((id,i)=>[id,edgeGroups[i].map(p=>p.id)]))};
}
