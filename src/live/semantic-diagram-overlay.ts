type Point = {x:number;y:number};
type Part = {id:string;bounds:{min:Point;max:Point}|null};
type Frame = {contentFrame:number;capturedAt:number;parts:Part[]};
type Plan = {caption:{text:string};nodes:{id:string;term:string}[];edges:{id:string;from:string;to:string;predicate:string}[]};
type Bindings = {nodeParts:Record<string,string[]>;edgeParts:Record<string,string[]>};
const overlap=(a:DOMRect,b:DOMRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
/** Source-bound overlay. Caller owns source/scene lease and canvas alignment. */
export class SemanticDiagramOverlay {
 lastFailure:string|null=null;
 lastFit:any=null;
 private layer:HTMLDivElement;
 constructor(private host:HTMLElement){
  this.layer=document.createElement('div');this.layer.dataset.semanticDiagram='experimental';
  Object.assign(this.layer.style,{position:'absolute',inset:'0',pointerEvents:'none',overflow:'hidden',font:'15px system-ui',color:'#e9f3ff'});host.append(this.layer);
 }
 clear(){this.layer.replaceChildren();}
 dispose(){this.layer.remove();}
 private label(text:string,x:number,y:number,width:number){
  const el=document.createElement('div');el.textContent=text;
  Object.assign(el.style,{position:'absolute',left:`${x}px`,top:`${y}px`,width:'max-content',maxWidth:`${width}px`,transform:'translate(-50%,-50%)',textAlign:'center',overflowWrap:'anywhere',background:'#0a1325',padding:'3px',boxSizing:'border-box',borderRadius:'4px'});
  this.layer.append(el);return el;
 }
 private anchor(ids:string[],frame:Frame){
  const groups=ids.map(id=>frame.parts.find(p=>p.id===id)?.bounds);
  if(!ids.length||groups.some(b=>!b))throw Error('diagram_anchor_missing');
  const min={x:Math.min(...groups.map(b=>b!.min.x)),y:Math.min(...groups.map(b=>b!.min.y))};
  const max={x:Math.max(...groups.map(b=>b!.max.x)),y:Math.max(...groups.map(b=>b!.max.y))};
  return {x:(min.x+max.x)/2,y:(min.y+max.y)/2,width:max.x-min.x,top:min.y};
 }
 draw(plan:Plan,bindings:Bindings,frame:Frame|null,leaseCurrent:boolean){
  this.clear();this.lastFailure=null;this.lastFit=null;const w=this.host.clientWidth,h=this.host.clientHeight;
  if(!leaseCurrent||!frame||frame.contentFrame<1||Date.now()-frame.capturedAt>500||Date.now()<frame.capturedAt||w<600||h<420){this.lastFailure='diagram_unavailable';return false;}
  try{
   const labels:HTMLElement[]=[];
   for(const n of plan.nodes){const p=this.anchor(bindings.nodeParts[n.id],frame);labels.push(this.label(n.term,p.x*w,p.y*h,Math.max(60,Math.min(180,p.width*w-12))));}
   for(const e of plan.edges){const p=this.anchor(bindings.edgeParts[e.id],frame),a=this.anchor(bindings.nodeParts[e.from],frame),b=this.anchor(bindings.nodeParts[e.to],frame);const vertical=Math.abs(a.x-b.x)<.05,diagonal=!vertical&&Math.abs(a.y-b.y)>.05;const label=this.label(e.predicate,p.x*w,vertical||diagonal?p.y*h:Math.min(a.top,b.top)*h-24,Math.min(260,w*.3));if(!vertical&&!diagonal){const from=labels[plan.nodes.findIndex(n=>n.id===e.from)].getBoundingClientRect(),to=labels[plan.nodes.findIndex(n=>n.id===e.to)].getBoundingClientRect();label.style.top=`${Math.min(from.top,to.top)-this.host.getBoundingClientRect().top-label.getBoundingClientRect().height/2-8}px`;}if(vertical){label.style.left=`${Math.max(a.x+a.width/2,b.x+b.width/2)*w+10}px`;label.style.transform='translate(0,-50%)';}labels.push(label);}
   const caption=this.label(plan.caption.text,w*.5,h*.88,w*.9);caption.style.fontSize='16px';labels.push(caption);
   const outer=this.host.getBoundingClientRect(),rects=labels.map(l=>l.getBoundingClientRect());
   this.lastFit={width:w,height:h,labels:labels.map((el,i)=>({text:el.textContent,x:rects[i].left-outer.left,y:rects[i].top-outer.top,width:rects[i].width,height:rects[i].height})),collisions:rects.flatMap((r,i)=>rects.map((s,j)=>j>i&&overlap(r,s)?[i,j]:null).filter(Boolean))};
   if(rects.some(r=>r.left<outer.left||r.right>outer.right||r.top<outer.top||r.bottom>outer.bottom)||rects.some((r,i)=>rects.slice(i+1).some(s=>overlap(r,s))))throw Error('diagram_text_fit');
   return true;
  }catch(error){this.lastFailure=error instanceof Error?error.message:'diagram_invalid';this.clear();return false;}
 }
}
