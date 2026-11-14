import {test} from 'vitest';
import assert from 'node:assert/strict';
import {compileSemanticDiagram} from '../integrations/semantic-diagram.mjs';
import {compileDiagramGeometry,diagramPointToWorld} from '../integrations/semantic-diagram-geometry.mjs';
import {composeExpression} from '../integrations/compose-expression.mjs';
const source={identity:'public',revision:1,text:'A B C D can connect.',unit:[0,20],unitId:'unit'};
const input={unitId:'unit',nodes:[0,1,2,3].map((slot)=>({id:`n${slot}`,term:[slot*2,slot*2+1],slot})),
 edges:[{id:'one',from:'n0',to:'n1',predicate:[8,19],direction:'forward'},
 {id:'two',from:'n2',to:'n3',predicate:[8,19],direction:'forward'}]};
test('maximal diagram compiles through actual existing DSL compiler:22 parts',()=>{
 const geometry=compileDiagramGeometry(compileSemanticDiagram(source,input)).payload;
 assert.equal(geometry.parts.length,22);
 const actual=composeExpression(geometry);
 assert.equal(actual.body.type,'parallel');
 assert.equal(actual.body.children[0].parts.length,22);
 assert.ok(geometry.parts.every(p=>p.kind==='curve'&&p.points.length===2));
 assert.equal(new Set(geometry.parts.map(p=>p.id)).size,22);
});
test('normalized role anchors map consistently to geometry coordinates',()=>{
 const plan=compileSemanticDiagram(source,input), geometry=compileDiagramGeometry(plan).payload;
 const n=plan.nodes[0];
 assert.deepEqual(geometry.parts[0].points[0],diagramPointToWorld([n.x-n.width/2,n.y-n.height/2]));
 assert.deepEqual(geometry.parts[16].points[0],diagramPointToWorld(plan.edges[0].line[0]));
 assert.equal(plan.caption.text,source.text);
});
test('undirected edges have no arrowhead and unsafe coordinates reject',()=>{
 const plan=compileSemanticDiagram(source,{...input,edges:[{...input.edges[0],direction:'none'}]});
 assert.equal(compileDiagramGeometry(plan).payload.parts.length,17);
 assert.throws(()=>compileDiagramGeometry({...plan,nodes:[{...plan.nodes[0],x:Infinity}]}));
 assert.throws(()=>compileDiagramGeometry({...plan,edges:[{...plan.edges[0],line:[[0,0],[0,0]]}]}));
});

test('maps every node and edge to distinct compiled parts; invalid refs reject',()=>{
 const plan=compileSemanticDiagram(source,input), result=compileDiagramGeometry(plan);
 assert.equal(result.nodeParts.n0.length,4);
 assert.equal(result.edgeParts.one.length,3);
 const mapped=[...Object.values(result.nodeParts),...Object.values(result.edgeParts)].flat();
 assert.deepEqual(mapped,result.payload.parts.map(p=>p.id));
 assert.throws(()=>compileDiagramGeometry({...plan,edges:[{...plan.edges[0],to:'absent'}]}));
 assert.throws(()=>compileDiagramGeometry({...plan,nodes:[plan.nodes[0],plan.nodes[0]]}));
});
