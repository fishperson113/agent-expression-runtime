import {test} from 'vitest';
import assert from 'node:assert/strict';
import {compileSemanticDiagram,projectSemanticDiagram} from '../integrations/semantic-diagram.mjs';
const text='Một source vẫn có thể cần nhiều kỹ thuật; với tác vụ đơn giản, cron và pandas có thể đủ.';
const span=s=>[text.indexOf(s),text.indexOf(s)+s.length];
const source={identity:'public:thread:turn:message',revision:1,text,unit:[0,text.length],unitId:'u1'};
const input={unitId:'u1',nodes:[{id:'source',term:span('Một source'),slot:0},{id:'tech',term:span('nhiều kỹ thuật'),slot:1}],
  edges:[{id:'relation',from:'source',to:'tech',predicate:span('vẫn có thể cần'),direction:'none'}]};
test('preserves exact modality and full contextual counterexample',()=>{
 const result=compileSemanticDiagram(source,input);
 assert.equal(result.edges[0].predicate,'vẫn có thể cần');
 assert.equal(result.caption.text,text);
 assert.equal(result.evidenceStatus,'exact-source-not-entailment-verified');
});
test('no authored paraphrase, claim, uncertainty score or HTML field',()=>{
 for(const patch of [{label:'vẫn cần'}, {confidence:.99}, {html:'<script/>'}])
 assert.throws(()=>compileSemanticDiagram(source,{...input,...patch}));
});
test('rejects stale unit selection and invalid reference',()=>{
 assert.throws(()=>compileSemanticDiagram(source,{...input,unitId:'u2'}));
 assert.throws(()=>compileSemanticDiagram(source,{...input,edges:[{...input.edges[0],to:'missing'}]}));
});
test('one deterministic projection binds roles and edges',()=>{
 const result=projectSemanticDiagram(compileSemanticDiagram(source,input),1000,600);
 assert.equal(result.nodes[0].x,270);
 assert.ok(Math.abs(result.edges[0].line[0][0]-440)<1e-9);
 assert.ok(Math.abs(result.edges[0].line[1][0]-560)<1e-9);
 assert.equal(result.caption.text,text);
});
test('bounded data, no silent truncation or viewport squeezing',()=>{
 assert.throws(()=>compileSemanticDiagram({...source,text:'a'.repeat(321),unit:[0,321]},input));
 assert.throws(()=>compileSemanticDiagram(source,{...input,nodes:Array(5).fill(input.nodes[0])}));
 assert.throws(()=>projectSemanticDiagram(compileSemanticDiagram(source,input),300,300));
});
test('substring evidence does NOT certify semantic entailment',()=>{
 const weak={...input,edges:[{...input.edges[0],predicate:span('cần')}]};
 assert.equal(compileSemanticDiagram(source,weak).evidenceStatus,'exact-source-not-entailment-verified');
 // A source-span validator alone cannot determine a missing qualifier. Production must not mistake this for proof.
});

test('negation and conditions remain in the required whole proposition',()=>{
 const quote='Nếu hàng đợi đầy, có thể bỏ khung hình; điều đó không có nghĩa là bỏ tin nhắn.';
 const locate=s=>[quote.indexOf(s),quote.indexOf(s)+s.length];
 const local={...source,text:quote,unit:[0,quote.length]};
 const record={unitId:'u1',nodes:[{id:'queue',term:locate('hàng đợi'),slot:0},{id:'frame',term:locate('khung hình'),slot:1}],
 edges:[{id:'possibility',from:'queue',to:'frame',predicate:locate('có thể bỏ'),direction:'none'}]};
 const result=compileSemanticDiagram(local,record);
 assert.equal(result.caption.text,quote);
 assert.ok(result.caption.text.includes('Nếu hàng đợi đầy'));
 assert.ok(result.caption.text.includes('không có nghĩa'));
 assert.equal(result.edges[0].predicate,'có thể bỏ');
 assert.equal(result.evidenceStatus,'exact-source-not-entailment-verified');
});
test('a sourced directional edge remains semantically unverified',()=>{
 const result=compileSemanticDiagram(source,{...input,edges:[{...input.edges[0],direction:'forward'}]});
 assert.equal(result.edges[0].direction,'forward');
 assert.equal(result.evidenceStatus,'exact-source-not-entailment-verified');
 assert.equal(result.caption.text,text);
});
