import {it,expect} from 'vitest';
import {diagramAuthorInput,parseDiagramAuthorRecord,diagramAuthorPolicy} from '../integrations/diagram-author.mjs';
const exchange={target:'A source can stay small. A source can need recovery.',userText:'question',publicContext:'Earlier context'};
const graph={mode:'diagram',unitId:'u0',nodes:[{id:'a',slot:0,term:'A source',occurrence:0},{id:'b',slot:1,term:'recovery'}],edges:[]};
it('keeps exact excerpt separate from bounded read-only context without mutating caller',()=>{
 const e={...exchange,userText:'x'.repeat(3000),publicContext:'y'.repeat(5000)};const before=structuredClone(e),input=diagramAuthorInput(e);
 expect(input.units[0].text).toBe(e.target);expect(input.context.userText).toHaveLength(2048);expect(input.context.publicPrefix).toHaveLength(4096);expect(e).toEqual(before);
});
it('supports explicit repeated span selection but never guesses an ambiguous occurrence',()=>{
 const r=parseDiagramAuthorRecord(JSON.stringify(graph),exchange);expect(r.diagram.plan.nodes[0].span).toEqual([0,8]);expect(r.diagram.plan.caption.text).toBe(exchange.target);
 const n=structuredClone(graph);delete n.nodes[0].occurrence;expect(()=>parseDiagramAuthorRecord(JSON.stringify(n),exchange)).toThrow('diagram_quote');
 n.nodes[0].occurrence=9;expect(()=>parseDiagramAuthorRecord(JSON.stringify(n),exchange)).toThrow('diagram_quote');
});
it('context cannot supply drawn terms and qualifiers stay in the literal caption',()=>{
 const n=structuredClone(graph);n.nodes[1].term='Earlier context';expect(()=>parseDiagramAuthorRecord(JSON.stringify(n),exchange)).toThrow('diagram_quote');
 expect(parseDiagramAuthorRecord(JSON.stringify(graph),exchange).diagram.plan.caption.text).toContain('can');
});
it('records bounded abstention categories without accepting arbitrary reason prose',()=>{
 expect(parseDiagramAuthorRecord('{"mode":"retain","reason":"missing_context"}',exchange)).toEqual({mode:'retain',payload:null,reason:'missing_context'});
 expect(()=>parseDiagramAuthorRecord('{"mode":"retain","reason":"arbitrary text"}',exchange)).toThrow('diagram_record');
 expect(diagramAuthorPolicy).toContain('unordered grouping');
});

it('bounds bytes before JSON parsing and rejects non-record input',()=>{
 for(const value of [null,{},'x'.repeat(65537),'é'.repeat(32769)])expect(()=>parseDiagramAuthorRecord(value,exchange)).toThrow('diagram_record_size');
 for(const value of ['null','[]','true'])expect(()=>parseDiagramAuthorRecord(value,exchange)).toThrow('diagram_record');
});
it('rejects oversized arrays before resolving their invalid quotes',()=>{
 for(const patch of [{nodes:[]},{nodes:Array(5).fill({term:'not in source'})},{edges:Array(3).fill({predicate:'not in source'})}])
 expect(()=>parseDiagramAuthorRecord(JSON.stringify({...graph,...patch}),exchange)).toThrow('diagram_record');
});
it('rejects unknown or malformed nested records rather than discarding fields',()=>{
 for(const extra of [{html:'<script/>'},{confidence:1},{unexpected:true}]){
  const value=structuredClone(graph);Object.assign(value.nodes[0],extra);
  expect(()=>parseDiagramAuthorRecord(JSON.stringify(value),exchange)).toThrow('diagram_record');
  const edge={id:'e',from:'a',to:'b',direction:'none',predicate:'can',occurrence:0,...extra};
  expect(()=>parseDiagramAuthorRecord(JSON.stringify({...graph,edges:[edge]}),exchange)).toThrow('diagram_record');
 }
 for(const bad of [null,[],0])expect(()=>parseDiagramAuthorRecord(JSON.stringify({...graph,nodes:[bad]}),exchange)).toThrow('diagram_record');
});
