export type Annotations = { labels: { text: string; x: number; y: number }[]; arrows: { from: [number, number]; to: [number, number] }[] };
const keys = (x: any, allowed: string[]) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(k => allowed.includes(k));
const unit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
export function validateAnnotations(value: unknown): Annotations {
  if (value === undefined) return { labels: [], arrows: [] };
  const v = value as Annotations;
  if (!keys(v, ['labels', 'arrows']) || !Array.isArray(v.labels) || !Array.isArray(v.arrows) || v.labels.length > 8 || v.arrows.length > 8) throw Error('annotations_invalid');
  let total = 0;
  const labels = v.labels.map(l => {
    if (!keys(l, ['text', 'x', 'y']) || typeof l.text !== 'string' || !l.text.trim() || [...l.text].length > 48 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(l.text) || !unit(l.x) || !unit(l.y)) throw Error('annotation_label_invalid');
    total += [...l.text].length;
    return { text: l.text, x: l.x, y: l.y };
  });
  if (total > 256) throw Error('annotation_text_budget');
  const arrows = v.arrows.map(a => {
    if (!keys(a, ['from', 'to']) || ![a.from,a.to].every(p => Array.isArray(p) && p.length === 2 && p.every(unit)) || a.from.every((n,i) => n === a.to[i])) throw Error('annotation_arrow_invalid');
    return { from: [...a.from] as [number,number], to: [...a.to] as [number,number] };
  });
  return { labels, arrows };
}
export function annotationLayout(value: Annotations, w: number, h: number) {
  if (w < 120 || h < 100) { if (value.labels.length || value.arrows.length) throw Error('annotation_panel_small'); return []; }
  const result: {x:number;y:number;width:number;height:number;lines:string[]}[]=[];
  for (const label of value.labels) {
    const font=13, maxChars=Math.max(8,Math.floor((w-24)/font)), chars=[...label.text];
    const lines:string[]=[];for(let i=0;i<chars.length;i+=maxChars)lines.push(chars.slice(i,i+maxChars).join(''));
    const width=Math.min(w-16,Math.max(...lines.map(s=>[...s].length))*font+12),height=lines.length*18+8;
    const x=Math.max(8,Math.min(w-width-8,label.x*w-width/2)),y=Math.max(8,Math.min(h-height-8,label.y*h-height/2));
    if(height>h-16 || result.some(r=>x<r.x+r.width&&x+width>r.x&&y<r.y+r.height&&y+height>r.y))throw Error('annotation_layout_conflict');
    result.push({x,y,width,height,lines});
  }
  return result;
}
type Scope = { epoch: string; sceneRevision: number };
/** Screen-space annotations, not world-space attachments. No model HTML, CSS or URLs. */
export class PresentationAnnotations {
  private layer: SVGSVGElement;
  private frame = 0;
  private resize: ResizeObserver;
  private active?: { value: Annotations; scope: Scope; until: number };
  constructor(private host: HTMLElement, private current: () => { epoch: string; revision: number } | null) {
    this.layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.layer.setAttribute('aria-label', 'Scene annotations');
    Object.assign(this.layer.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' });
    host.append(this.layer);
    this.resize = new ResizeObserver(() => this.draw()); this.resize.observe(host);
  }
  prepare(value: Annotations) { annotationLayout(value, this.host.clientWidth, this.host.clientHeight); }
  clear() { this.active = undefined; cancelAnimationFrame(this.frame); this.frame = 0; this.layer.replaceChildren(); }
  set(value: Annotations, scope: Scope, sourceDeadline?: number) {
    const now=performance.now(), current=this.current();
    const until=sourceDeadline === undefined ? now+30000 : Math.min(sourceDeadline,now+30000);
    // A delayed/expired receipt must not erase annotations owned by a newer scene.
    if (!Number.isFinite(until) || until<=now || !current || current.epoch!==scope.epoch || current.revision!==scope.sceneRevision) return false;
    this.clear(); this.active = { value, scope: { ...scope }, until }; this.draw();
    const check = () => {
      const s = this.current();
      if (!s || !this.active || performance.now() >= this.active.until || s.epoch !== this.active.scope.epoch || s.revision !== this.active.scope.sceneRevision) { this.clear(); return; }
      this.frame = requestAnimationFrame(check);
    };
    check(); return true;
  }
  dispose() { this.clear(); this.resize.disconnect(); this.layer.remove(); }
  private draw() {
    this.layer.replaceChildren(); if (!this.active) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (w < 120 || h < 100) return;
    this.layer.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const make = (tag: string, attrs: Record<string,string | number>) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k,v] of Object.entries(attrs)) node.setAttribute(k,String(v));
      this.layer.append(node); return node;
    };
    for (const a of this.active.value.arrows) {
      const x1=8+a.from[0]*(w-16), y1=8+a.from[1]*(h-16), x2=8+a.to[0]*(w-16), y2=8+a.to[1]*(h-16);
      const angle=Math.atan2(y2-y1,x2-x1), len=7;
      make('path', { d:`M${x1},${y1} L${x2},${y2} M${x2-len*Math.cos(angle-.5)},${y2-len*Math.sin(angle-.5)} L${x2},${y2} L${x2-len*Math.cos(angle+.5)},${y2-len*Math.sin(angle+.5)}`, fill:'none',stroke:'#b9d8ff','stroke-width':2 });
    }
    let layout: ReturnType<typeof annotationLayout>;
    try { layout = annotationLayout(this.active.value, w, h); } catch { this.layer.replaceChildren(); return; }
    for (const { x, y, width, height, lines } of layout) {
      const font = 13;
      make('rect',{x,y,width,height,rx:5,fill:'#081526','fill-opacity':.88});
      const text=make('text',{x:x+6,y:y+18,fill:'#e9f3ff','font-family':'system-ui, sans-serif','font-size':font});
      lines.forEach((line,i)=>{const span=document.createElementNS('http://www.w3.org/2000/svg','tspan');span.setAttribute('x',String(x+6));span.setAttribute('y',String(y+18+i*18));span.textContent=line;text.append(span);});
    }
  }
}
