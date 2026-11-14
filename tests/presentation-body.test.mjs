import {expect,it} from 'vitest';
import {presentationBody} from '../integrations/presentation-body.mjs';
const scope={epoch:'host-epoch',sceneRevision:7};
const part={id:'dot',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]};
it('retains without constructing body and rejects unknown decisions',()=>{
 expect(presentationBody({mode:'retain',payload:null},scope)).toBeNull();
 expect(()=>presentationBody({mode:'other'},scope)).toThrow('presentation_decision');
});
it('compiles additive parts and removal under the host-owned scene scope',()=>{
 const add=presentationBody({mode:'compose',payload:{base:'current_scene',parts:[part]}},scope);
 expect(add.configuration.sceneAppend).toBe(true);
 const remove=presentationBody({mode:'compose',payload:{base:'current_scene',parts:[],removePartIds:['dot'],expectedEpoch:'invented',expectedSceneRevision:1}},scope);
 expect(remove.configuration.sceneRemove).toEqual(['dot']);expect(remove.configuration.sceneRevision).toBe(7);
});
it('does not mutate source decisions or scope and leaves geometry validation to existing compiler',()=>{
 const decision={mode:'compose',payload:{base:'none',parts:[part]}},before=structuredClone({decision,scope});
 expect(presentationBody(decision,scope)).toBeTruthy();expect({decision,scope}).toEqual(before);
 expect(()=>presentationBody({mode:'compose',payload:{base:'none',parts:[{...part,scale:[-1,1,1]}]}},scope)).toThrow();
});
it('returns animation data only, without constructing a transport or publishing text',()=>{
 const config={preset:'calm'};expect(presentationBody({mode:'animate',payload:config},scope)).toEqual({type:'live',program:null,configuration:config});
});
