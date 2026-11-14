import { expect, it, vi } from 'vitest';
import { validateAnnotations, annotationLayout } from '../src/live/presentation-annotations';
import { PresentationAdmission } from '../src/live/presentation-admission';
const good = { labels: [{text:'Event time',x:.2,y:.3}], arrows:[{from:[.2,.4],to:[.8,.4]}] };
it('copies bounded plain text and normalized screen anchors',()=>{
 const result=validateAnnotations(good); expect(result).toEqual(good);expect(result.labels[0]).not.toBe(good.labels[0]);
 expect(validateAnnotations(undefined)).toEqual({labels:[],arrows:[]});
 expect(validateAnnotations({...good,labels:[{text:'<img src=x>',x:0,y:1}]}).labels[0].text).toBe('<img src=x>');
});
it.each([
 {...good, html:'x'}, {...good,labels:[{text:'x',x:NaN,y:0}]}, {...good,labels:[{text:'x',x:1.1,y:0}]},
 {...good,labels:[{text:'x'.repeat(49),x:0,y:0}]}, {...good,labels:Array(9).fill({text:'x',x:0,y:0})},
 {...good,labels:Array(8).fill({text:'x'.repeat(33),x:0,y:0})}, {...good,labels:[{text:'a\u202eb',x:0,y:0}]},
 {...good,arrows:[{from:[0,0],to:[0,0]}]}, {...good,arrows:[{from:[0,0],to:[2,0]}]},
 {...good,labels:[{text:'x',x:0,y:0,style:'url(x)'}]}
])('rejects malformed annotations before admission',input=>expect(()=>validateAnnotations(input)).toThrow());
it('validates before geometry mutation, preserves canonical chat, and clears on invalidation',()=>{
 const snapshot={threadId:'t',generation:1,available:true,messages:[{role:'user',turn:'u'},{role:'assistant',turn:'u',status:'completed'}]};
 const state={documentId:'d',stopped:false,hidden:false,snapshot,scene:{epoch:'e',revision:1,partIds:['face']}};
 const admit=vi.fn((_body: unknown, _scope: unknown, _valid: unknown, _annotations: unknown)=>({status:'accepted',sceneRevision:2})),clear=vi.fn();
 const gate=new PresentationAdmission(()=>state,admit,()=>0,clear);
 let scope=gate.snapshot({documentId:'d',threadId:'t',turnId:'u',generation:1})!.scope;
 expect(gate.apply({scope,body:{},annotations:{html:'bad'}}).status).toBe('rejected');expect(admit).not.toHaveBeenCalled();expect(clear).toHaveBeenCalledOnce();
 scope=gate.snapshot({documentId:'d',threadId:'t',turnId:'u',generation:1})!.scope;
 expect(gate.apply({scope,body:{},annotations:good}).status).toBe('accepted');expect(admit.mock.calls[0][3]).toEqual(good);
 expect(snapshot.messages).toHaveLength(2);gate.invalidate();expect(clear).toHaveBeenCalledTimes(2);
});

it('rejects conflicting layout rather than moving labels relative to arrows',()=>{
 const collision=validateAnnotations({...good,labels:[{text:'A',x:.5,y:.5},{text:'B',x:.5,y:.5}]});
 expect(()=>annotationLayout(collision,320,240)).toThrow('annotation_layout_conflict');
 expect(()=>annotationLayout(validateAnnotations(good),100,90)).toThrow('annotation_panel_small');
});
