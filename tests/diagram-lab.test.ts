import {expect,it,vi,afterEach} from 'vitest';
import {validateLabDiagram,DiagramLab} from '../src/live/diagram-lab';
const caption='Flink processes events.';
const body={type:'assemble',parts:[{id:'box_a',kind:'curve'},{id:'box_b',kind:'curve'},{id:'arrow',kind:'curve'}]};
const diagram={plan:{caption:{text:caption},nodes:[{id:'a',term:'Flink'},{id:'b',term:'events'}],edges:[{id:'e',from:'a',to:'b',predicate:'processes'}]},nodeParts:{a:['box_a'],b:['box_b']},edgeParts:{e:['arrow']}};
it('accepts exact public caption with geometry-bound terms and relations',()=>expect(validateLabDiagram(diagram,body,caption)).toEqual(diagram));
it.each(['caption','term','predicate','mapping','unbound','duplicate','empty'])('rejects unsafe or ungrounded diagram %s',kind=>{
 const d=structuredClone(diagram),b=structuredClone(body);
 if(kind==='caption')d.plan.caption.text='Invented';if(kind==='term')d.plan.nodes[0].term='Spark';if(kind==='predicate')d.plan.edges[0].predicate='causes';
 if(kind==='mapping')d.edgeParts.e=['missing'];if(kind==='unbound')b.parts.push({id:'extra',kind:'curve'});if(kind==='duplicate')d.nodeParts.b=['box_a'];if(kind==='empty')b.parts=[];
 expect(()=>validateLabDiagram(d,b,caption)).toThrow();
});

const mocks=vi.hoisted(()=>({draw:vi.fn(()=>true),clear:vi.fn()}));
vi.mock('../src/live/semantic-diagram-overlay',()=>({SemanticDiagramOverlay:class{draw=mocks.draw;clear=mocks.clear;dispose=vi.fn();lastFailure='diagram_text_fit';}}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();mocks.draw.mockReset().mockReturnValue(true);});
function setup(){let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);const tasks:(()=>void)[]=[];
 vi.stubGlobal('requestAnimationFrame',(cb:()=>void)=>{tasks.push(cb);return tasks.length;});vi.stubGlobal('cancelAnimationFrame',()=>{});
 const rect={left:0,top:0,width:900,height:600};const canvas={getBoundingClientRect:()=>rect,parentElement:{getBoundingClientRect:()=>({...rect})},style:{visibility:''}} as any,state={epoch:'e',revision:2,seq:3,busy:false};let frame:any={frameId:10,contentFrame:10,viewport:{width:900,height:600},parts:[]};
 const invalidate=vi.fn(()=>lab.clear()),lab=new DiagramLab(canvas,()=>state,()=>frame,invalidate);
 lab.start(validateLabDiagram(diagram,body,caption),{epoch:'e',sceneRevision:2,seq:3},10,10000);
 return {lab,canvas,state,invalidate,tick:()=>tasks.shift()?.(),settle:()=>{tasks.shift()?.();now+=160;if(frame)frame.frameId++;tasks.shift()?.();},frame:(n:number)=>{frame={frameId:n,contentFrame:n,viewport:{width:900,height:600},parts:[]};},lost:()=>{frame=null;},time:(n:number)=>{now=n;}};
}
it('hides geometry until new settled displayed frame and exposes first-visible telemetry',()=>{
 const f=setup();f.tick();expect(f.canvas.style.visibility).toBe('hidden');expect(mocks.draw).not.toHaveBeenCalled();
 f.frame(11);f.state.busy=true;f.tick();expect(mocks.draw).not.toHaveBeenCalled();
 f.state.busy=false;f.time(120);f.settle();expect(f.canvas.style.visibility).toBe('');expect(f.lab.status()).toMatchObject({visible:true,firstVisibleAt:280,frameId:12});
 f.lab.clear();expect(f.lab.status().visible).toBe(false);
});
it('hides complete diagram on layout failure then retires after bounded wait',()=>{
 const f=setup();f.frame(11);mocks.draw.mockReturnValue(false);f.settle();expect(f.canvas.style.visibility).toBe('hidden');expect(f.lab.status().visible).toBe(false);
 f.time(2161);f.tick();expect(f.invalidate).toHaveBeenCalledOnce();expect(f.lab.status().reason).toBe('diagram_text_fit');
});
it('stale ownership clears overlay without retiring a newer external scene',()=>{
 const f=setup();f.state.seq=4;f.tick();expect(f.lab.status().visible).toBe(false);expect(f.invalidate).not.toHaveBeenCalled();
});

it('hides geometry and captions if projection disappears after visibility',()=>{
 const f=setup();f.frame(11);f.settle();expect(f.lab.status().visible).toBe(true);
 f.lost();f.tick();expect(f.lab.status().visible).toBe(false);expect(f.canvas.style.visibility).toBe('hidden');
 f.time(2161);f.tick();expect(f.invalidate).toHaveBeenCalledOnce();
});

it('expires at the original source deadline even when the diagram stays visible',()=>{
 const f=setup();f.frame(11);f.settle();expect(f.lab.status().visible).toBe(true);
 f.time(10000);f.tick();expect(f.invalidate).toHaveBeenCalledOnce();expect(f.lab.status().visible).toBe(false);
});

it('rejects an earlier caption even when it occurs inside a broader prefix',()=>{
 expect(()=>validateLabDiagram(diagram,body,'Intro. '+caption)).toThrow('diagram_source');
});
it('fails closed when displayed viewport no longer matches the canvas',()=>{
 const f=setup();f.frame(11);f.canvas.getBoundingClientRect=()=>({left:12,top:0,width:900,height:600});f.tick();
 expect(f.invalidate).toHaveBeenCalledOnce();expect(f.lab.status().reason).toBe('diagram_viewport_mismatch');
});
it('dispose cancels pending rendering and restores canvas visibility',()=>{
 const f=setup();f.lab.dispose();f.tick();expect(mocks.draw).not.toHaveBeenCalled();expect(f.canvas.style.visibility).toBe('');
});

it('does not count repeated inspection of one submitted frame as settled rendering',()=>{
 const f=setup();f.frame(11);f.tick();f.time(200);f.tick();expect(f.lab.status().visible).toBe(false);
 expect(mocks.draw).not.toHaveBeenCalled();f.frame(12);f.tick();expect(f.lab.status().visible).toBe(true);
});
