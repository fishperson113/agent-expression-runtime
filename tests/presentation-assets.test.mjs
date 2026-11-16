import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createPresentationAssetLibrary} from '../integrations/presentation-assets.mjs';
import {createPresentationRecordStream} from '../integrations/presentation-records.mjs';
const record={mode:'compose',payload:{base:'none',parts:[{id:'shape',kind:'ellipsoid',center:[0,0,0],scale:[0.2,0.3,0.2]}]}};
const entry=()=>({id:'sample',description:'A simple oval, with no assigned emotion.',record:structuredClone(record)});
const ref=library=>JSON.stringify({base:'reuse',assetId:library.catalog[0].id,sha256:library.catalog[0].sha256});
it('copies immutable geometry and leaves retain and new composition available',()=>{
 const input=entry(),library=createPresentationAssetLibrary([input]),text=ref(library);input.record.payload.parts[0].center[0]=1;
 const a=library.parseRecord(text);expect(a.payload.parts[0].center[0]).toBe(0);a.payload.parts[0].center[0]=1;
 expect(library.parseRecord(text).payload.parts[0].center[0]).toBe(0);expect(Object.isFrozen(library.catalog[0])).toBe(true);
 expect(library.parseRecord('{"base":"retain"}')).toEqual({mode:'retain',payload:null});
 expect(library.parseRecord('{"base":"replace","parts":[["e","new",0,0,0,0.2,0.2,0.2]]}').payload.parts[0].id).toBe('new');
 expect(library.policy).toContain('Do not force a catalog match');expect(library.catalog[0]).not.toHaveProperty('record');
});
it('rejects malformed catalogs and canonical geometry without normalizing them',()=>{
 for(const values of [[],Array(9).fill(entry()),[entry(),entry()],[{...entry(),id:undefined}],[{...entry(),description:'bad\ntext'}],
  [{...entry(),record:{mode:'retain',payload:null}}],[{...entry(),record:{...record,payload:{...record.payload,base:'current_scene'}}}]])expect(()=>createPresentationAssetLibrary(values)).toThrow();
 const bad=entry();bad.record.payload.parts[0].scale[0]=0.018;expect(()=>createPresentationAssetLibrary([bad])).toThrow();
});
it('rejects stale hashes and all model-provided authority or timing overrides',()=>{
 const library=createPresentationAssetLibrary([entry()]),value=JSON.parse(ref(library));
 for(const change of [{assetId:'unknown'},{sha256:'0'.repeat(64)},{scope:{}},{remainingTtlMs:10000},{durationMs:500},{motions:[]}])expect(()=>library.parseRecord(JSON.stringify({...value,...change}))).toThrow();
 const changed=entry();changed.record.payload.parts[0].center[0]=0.1;expect(()=>createPresentationAssetLibrary([changed]).parseRecord(JSON.stringify(value))).toThrow();
});
it('keeps atomic source gating before and after reference decoding',()=>{
 const library=createPresentationAssetLibrary([entry()]);let current=true;
 const stream=createPresentationRecordStream({isCurrent:()=>current,parseRecord:library.parseRecord});const text=ref(library);
 expect(stream.push(text.slice(0,-1))).toEqual([]);current=false;expect(()=>stream.push('}')).toThrow('presentation_record_stale');
 const complete=createPresentationRecordStream({isCurrent:()=>true,parseRecord:library.parseRecord});expect(complete.push(text)[0].assetProvenance.id).toBe('sample');expect(()=>complete.push(text)).toThrow('presentation_record_extra');
});
it('loads the optional offline artwork with finite authored tracks and disclosed refinement',()=>{
 const asset=JSON.parse(readFileSync(new URL('../integrations/assets/ribbon-swim.json',import.meta.url),'utf8'));
 const library=createPresentationAssetLibrary([asset]),result=library.parseRecord(ref(library));
 expect(result.payload.parts).toHaveLength(20);expect(result.payload.tracks).toHaveLength(2);
 expect(result.payload.parts.find(p=>p.id==='body').weight).toBe(4);expect(asset.provenance.refinement).toEqual({bodyWeight:4,bellyWeight:2});
 expect(result).not.toHaveProperty('scope');expect(result.payload).not.toHaveProperty('expectedEpoch');
});
