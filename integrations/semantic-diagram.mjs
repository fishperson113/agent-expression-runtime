const fail = reason => { throw Error(`diagram_${reason}`); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => plain(value) && Object.keys(value).every(k => allowed.includes(k));
const safeText = text => typeof text === 'string' && text.trim() && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text);
const id = text => typeof text === 'string' && /^[a-z][a-z0-9_-]{0,31}$/u.test(text);
const slots = [[.27,.22],[.73,.22],[.27,.53],[.73,.53]];

function spanText(text, span, max = 48) {
  if (!Array.isArray(span) || span.length !== 2 || !span.every(Number.isSafeInteger)) fail('span');
  const [start, end] = span;
  if (start < 0 || end <= start || end > text.length) fail('span');
  if ((start && /[\uDC00-\uDFFF]/u.test(text[start])) || /[\uDC00-\uDFFF]/u.test(text[end] ?? '')) fail('unicode_span');
  const result = text.slice(start,end);
  if (!safeText(result) || [...result].length > max) fail('text');
  return result;
}

function sourceUnit(source) {
  if (!keys(source,['identity','revision','text','unit','unitId']) || !safeText(source.identity)
    || source.identity.length > 256 || !Number.isSafeInteger(source.revision) || source.revision < 1
    || typeof source.text !== 'string' || source.text.length > 65536 || !id(source.unitId)) fail('source');
  const quote = spanText(source.text,source.unit,320);
  return { quote, identity:source.identity, revision:source.revision, unitId:source.unitId,
    start:source.unit[0], end:source.unit[1] };
}

function nodePlan(node, quote, usedSlots) {
  if (!keys(node,['id','term','slot']) || !id(node.id) || !Number.isInteger(node.slot)
    || node.slot < 0 || node.slot > 3 || usedSlots.has(node.slot)) fail('node');
  usedSlots.add(node.slot);
  const [x,y] = slots[node.slot];
  return { id:node.id, term:spanText(quote,node.term,40), span:[...node.term],
    x,y,width:.34,height:.16 };
}

function edgePlan(edge, quote, nodes) {
  if (!keys(edge,['id','from','to','predicate','direction']) || !id(edge.id)
    || !['none','forward'].includes(edge.direction) || edge.from === edge.to) fail('edge');
  const a=nodes.find(n=>n.id===edge.from), b=nodes.find(n=>n.id===edge.to);
  if (!a || !b) fail('edge_node');
  const dx=b.x-a.x,dy=b.y-a.y;
  const ratio=1/Math.max(Math.abs(dx)/(a.width/2),Math.abs(dy)/(a.height/2));
  return { id:edge.id,from:edge.from,to:edge.to,direction:edge.direction,
    predicate:spanText(quote,edge.predicate,96), span:[...edge.predicate],
    line:[[a.x+dx*ratio,a.y+dy*ratio],[b.x-dx*ratio,b.y-dy*ratio]],
    label:[(a.x+b.x)/2,(a.y+b.y)/2] };
}

/** Experimental source-bound diagram IR. Not imported by Live or MAIN. */
export function compileSemanticDiagram(source, input) {
  const evidence=sourceUnit(source);
  if (!keys(input,['unitId','nodes','edges']) || input.unitId !== evidence.unitId
    || !Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > 4
    || !Array.isArray(input.edges) || input.edges.length > 2) fail('input');
  const usedSlots=new Set();
  const nodes=input.nodes.map(n=>nodePlan(n,evidence.quote,usedSlots));
  const edges=input.edges.map(e=>edgePlan(e,evidence.quote,nodes));
  if (new Set(nodes.map(n=>n.id)).size !== nodes.length || new Set(edges.map(e=>e.id)).size !== edges.length) fail('duplicate_id');
  return { version:1,evidence,nodes,edges,
    evidenceStatus:'exact-source-not-entailment-verified',
    projection:'normalized-diagram-plane',caption:{ text:evidence.quote,x:.5,y:.84,width:.9 } };
}

/** All coordinates and labels share this projection; no detached auto-framing. */
export function projectSemanticDiagram(plan, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 600 || height < 420
    || width > 8192 || height > 8192) fail('viewport');
  const point=([x,y])=>[x*width,y*height];
  return { ...plan,nodes:plan.nodes.map(n=>({...n,x:n.x*width,y:n.y*height,width:n.width*width,height:n.height*height})),
    edges:plan.edges.map(e=>({...e,line:e.line.map(point),label:point(e.label)})),
    caption:{...plan.caption,x:plan.caption.x*width,y:plan.caption.y*height,width:plan.caption.width*width} };
}
