import { SemanticDiagramOverlay } from './semantic-diagram-overlay';
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && [...v].length <= max && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(v);
export function validateLabDiagram(diagram: any, body: unknown, sourceQuote: string) {
  if (!diagram || JSON.stringify({diagram,body}).length > 32768) throw Error('diagram_budget');
  const p=diagram.plan;
  if (!p || !text(p.caption?.text,320) || p.caption.text !== sourceQuote || !Array.isArray(p.nodes) || !p.nodes.length || p.nodes.length>4 || !Array.isArray(p.edges) || p.edges.length>2) throw Error('diagram_source');
  const ids=new Set<string>();
  const walk=(v:any,depth=0)=>{if(depth>12)throw Error('diagram_depth');if(!v||typeof v!=='object')return;
    if(v.type==='assemble'){if(!Array.isArray(v.parts)||v.parts.length>24)throw Error('diagram_parts');for(const part of v.parts){if(!id(part.id)||ids.has(part.id))throw Error('diagram_part_id');ids.add(part.id);}}
    for(const [k,value] of Object.entries(v)){if(k==='parts')continue;if(Array.isArray(value))value.forEach(x=>walk(x,depth+1));else if(value&&typeof value==='object')walk(value,depth+1);}};
  walk(body); if(!ids.size)throw Error('diagram_geometry_required');
  const nodes=new Set<string>(),edges=new Set<string>(),bound=new Set<string>();
  const binding=(table:any,key:string,max:number)=>{const refs=table?.[key];if(!Array.isArray(refs)||!refs.length||refs.length>max)throw Error('diagram_binding');
    for(const ref of refs){if(!ids.has(ref)||bound.has(ref))throw Error('diagram_binding');bound.add(ref);}return [...refs];};
  const nodeParts:Record<string,string[]>={},edgeParts:Record<string,string[]>={};
  const cleanNodes=p.nodes.map((n:any)=>{if(!id(n.id)||nodes.has(n.id)||!text(n.term,40)||!p.caption.text.includes(n.term))throw Error('diagram_node');nodes.add(n.id);nodeParts[n.id]=binding(diagram.nodeParts,n.id,4);return {id:n.id,term:n.term};});
  const cleanEdges=p.edges.map((e:any)=>{if(!id(e.id)||edges.has(e.id)||!nodes.has(e.from)||!nodes.has(e.to)||e.from===e.to||!text(e.predicate,96)||!p.caption.text.includes(e.predicate))throw Error('diagram_edge');edges.add(e.id);edgeParts[e.id]=binding(diagram.edgeParts,e.id,3);return {id:e.id,from:e.from,to:e.to,predicate:e.predicate};});
  if(bound.size!==ids.size)throw Error('diagram_unbound_geometry');
  return {plan:{caption:{text:p.caption.text},nodes:cleanNodes,edges:cleanEdges},nodeParts,edgeParts};
}
/** Explicit URL-enabled experiment. Uses the existing presentation authority, not an alternate gate. */
export class DiagramLab {
  private overlay:SemanticDiagramOverlay;
  private frame=0;
  private telemetry:any={visible:false,reason:'idle',firstVisibleAt:null,frameId:null};
  status(){return {...this.telemetry,owned:this.telemetry.owned?{...this.telemetry.owned}:null};}
  private active?:{diagram:ReturnType<typeof validateLabDiagram>;owned:{epoch:string;sceneRevision:number;seq:number};after:number;until:number;waitUntil:number;settle?:{at:number;frameId:number;points:number[]}};
  constructor(private canvas:HTMLCanvasElement, private current:()=>any, private projection:()=>any, private invalidate:()=>void){this.overlay=new SemanticDiagramOverlay(canvas.parentElement!);}
  clear(){this.active=undefined;cancelAnimationFrame(this.frame);this.frame=0;this.overlay.clear();this.canvas.style.visibility='';this.telemetry={...this.telemetry,visible:false,reason:'cleared',at:performance.now()};}
  dispose(){this.clear();this.overlay.dispose();}
  start(diagram:ReturnType<typeof validateLabDiagram>,owned:{epoch:string;sceneRevision:number;seq:number},after:number,deadline:number){
    this.clear();if(!Number.isFinite(deadline)||deadline<=performance.now())throw Error('diagram_expired');this.active={diagram,owned,after,until:deadline,waitUntil:Math.min(deadline,performance.now()+2000)};this.telemetry={visible:false,reason:'waiting_frame',firstVisibleAt:null,frameId:null,at:performance.now(),owned:{...owned}};this.canvas.style.visibility='hidden';
    const selected=this.active;
    const draw=()=>{try{
      const a=this.active;if(!a||a!==selected)return;const state=this.current();
      if(!state||state.epoch!==a.owned.epoch||state.revision!==a.owned.sceneRevision||state.seq!==a.owned.seq){this.clear();return;}
      if(performance.now()>=a.until){this.invalidate();return;}
      const frame=this.projection();
      const rect=this.canvas.getBoundingClientRect(),host=this.canvas.parentElement!.getBoundingClientRect();
      const aligned=frame&&[rect.left-host.left,rect.top-host.top,rect.width-host.width,rect.height-host.height,
        rect.width-frame.viewport?.width,rect.height-frame.viewport?.height].every(n=>Number.isFinite(n)&&Math.abs(n)<=1);
      if(frame&&!aligned){this.invalidate();this.telemetry.reason='diagram_viewport_mismatch';return;}
      if(frame&&frame.contentFrame>a.after&&!state.busy){
        if(this.telemetry.firstVisibleAt===null){
          const points=frame.parts.flatMap((p:any)=>p.bounds?[p.bounds.min.x*rect.width,p.bounds.min.y*rect.height,p.bounds.max.x*rect.width,p.bounds.max.y*rect.height]:[]);
          if(!a.settle||a.settle.points.length!==points.length||points.some((n:number,i:number)=>Math.abs(n-a.settle!.points[i])>3))a.settle={at:performance.now(),frameId:frame.frameId,points};
          if(performance.now()-a.settle.at<150||!Number.isSafeInteger(frame.frameId)||frame.frameId<=a.settle.frameId){
            if(performance.now()>=a.waitUntil){this.invalidate();this.telemetry.reason='frame_unsettled';return;}
            this.telemetry.reason='settling_frame';this.frame=requestAnimationFrame(draw);return;
          }
        }
        const ok=this.overlay.draw(a.diagram.plan,a.diagram,frame,true);
        if(!ok){this.canvas.style.visibility='hidden';this.telemetry.visible=false;this.telemetry.reason=this.overlay.lastFailure;this.telemetry.fit=this.overlay.lastFit;if(performance.now()>=a.waitUntil){const reason=this.overlay.lastFailure;this.invalidate();this.telemetry.reason=reason;return;}}
        else {this.canvas.style.visibility='';this.telemetry={...this.telemetry,visible:true,reason:'visible',fit:this.overlay.lastFit,at:performance.now(),firstVisibleAt:this.telemetry.firstVisibleAt??performance.now(),frameId:frame.frameId};a.waitUntil=performance.now()+2000;}
      }
      if(!frame||frame.contentFrame<=a.after||state.busy){this.canvas.style.visibility='hidden';this.overlay.clear();this.telemetry.visible=false;this.telemetry.reason='waiting_frame';}
      if(performance.now()>=a.waitUntil&&!this.telemetry.visible){this.invalidate();this.telemetry.reason='frame_timeout';return;}
      this.frame=requestAnimationFrame(draw);
    }catch{this.canvas.style.visibility='hidden';try{this.invalidate();}catch{this.clear();}}};
    this.frame=requestAnimationFrame(draw);
  }
}
