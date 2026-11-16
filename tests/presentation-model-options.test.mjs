import {it,expect,vi,beforeEach} from 'vitest';
import {presentationModelOptions,visualModelOptions} from '../integrations/presentation-model-options.mjs';
const calls=vi.hoisted(()=>({options:[],generations:0,error:'presentation_model_unsupported'}));
vi.mock('../integrations/presentation-provider.mjs',()=>({NativePresentationProvider:class {
 constructor(options){calls.options.push(options);}
 async generate(){calls.generations++;throw Error(calls.error);}
 close(){}
}}));
import {LiveStreamingPresentationBridge} from '../integrations/presentation-streaming-bridge.mjs';
beforeEach(()=>{calls.options=[];calls.generations=0;calls.error='presentation_model_unsupported';});
it('only absent pair is default and exact pair is forwarded without coercion',()=>{
 expect(presentationModelOptions({})).toEqual({});
 expect(presentationModelOptions({FISCH_VISUAL_MODEL:'gpt-6-luna',FISCH_VISUAL_EFFORT:'low'})).toEqual({visualModel:'gpt-6-luna',visualEffort:'low'});
 for(const pair of [[undefined,'low'],['model',undefined],['','low'],['model',''],[null,'low'],[true,'low'],[' model','low'],['model','Low'],['model','low '],['model\n','low'],['model','low\n'],['a'.repeat(129),'low']])expect(()=>visualModelOptions(...pair)).toThrow('presentation_model_config_invalid');
});
it('preserves exact default constructor arguments and forwards the explicit pair',()=>{
 const host={},runtime={},base={state:{},page:{},host,runtime};
 new LiveStreamingPresentationBridge(base);
 expect(calls.options).toEqual([{host,runtime,timeoutMs:30000,protocol:'freeform'}]);
 new LiveStreamingPresentationBridge({...base,visualModel:'gpt-6-luna',visualEffort:'low'});
 expect(calls.options[1]).toEqual({...calls.options[0],visualModel:'gpt-6-luna',visualEffort:'low'});
});
it('rejects malformed pairs and supplied-provider conflict before default allocation',()=>{
 expect(()=>new LiveStreamingPresentationBridge({visualModel:'model'})).toThrow('presentation_model_config_invalid');
 expect(()=>new LiveStreamingPresentationBridge({provider:{},visualModel:'model',visualEffort:'low'})).toThrow('presentation_model_provider_conflict');
 expect(calls.options).toEqual([]);
});
function fixture(){
 const snapshot={available:true,generation:1,revision:1,ownerTurn:'t',messages:[{id:'u',turn:'t',role:'user',status:'completed',text:'Explain'}, {id:'a',turn:'t',role:'assistant',status:'streaming',text:''}]};
 const events=[],state={channel:{token:'d'},output:{thread:'h'},conversation:{snapshot:()=>snapshot}};
 let ticket=0;
 const page={evaluate:async(fn,arg)=>{if(String(fn).includes('presentationPreparationTicket'))return {intentVersion:0,preparationVersion:++ticket};if(arg?.identity)return {scope:{epoch:'e',sceneRevision:1},partIds:[]};}};
 const bridge=new LiveStreamingPresentationBridge({state,page,visualModel:'model',visualEffort:'low',now:()=>1000,checkpoints:{minChars:10,cooldownMs:0},onEvent:e=>events.push(e)});
 const send=(method,extra={})=>bridge.observe({method,params:{threadId:'h',turnId:snapshot.ownerTurn,...extra}});
 const start=()=>send('item/started',{item:{id:'a',type:'agentMessage',phase:'final_answer'}});
 const append=()=>{snapshot.messages[1].text+='A complete public statement for the visual author. ';snapshot.revision++;send('item/agentMessage/delta',{itemId:'a'});};
 return {bridge,snapshot,events,start,append};
}
it('catalog unsupported latches only the visual session across new sources and turns',async()=>{
 const f=fixture();try{
 f.start();f.append();await vi.waitFor(()=>expect(f.bridge.visualUnavailable).toBe(true));
 expect(calls.generations).toBe(1);expect(f.snapshot.available).toBe(true);
 f.bridge.invalidate();f.snapshot.ownerTurn='new';for(const m of f.snapshot.messages)m.turn='new';f.start();f.append();
 await new Promise(r=>setTimeout(r,20));expect(calls.generations).toBe(1);
 expect(f.events.filter(e=>e.type==='unavailable')).toHaveLength(1);
 const fresh=fixture();expect(fresh.bridge.visualUnavailable).toBeUndefined();fresh.bridge.close();
 }finally{f.bridge.close();}
});
it('unclassified author failures do not latch unsupported configuration',async()=>{
 calls.error='transient_provider_error';const f=fixture();try{f.start();f.append();await vi.waitFor(()=>expect(f.events.some(e=>e.type==='author_end')).toBe(true));expect(f.bridge.visualUnavailable).toBeUndefined();}finally{f.bridge.close();}
});
