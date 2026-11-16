import {createHash} from 'node:crypto';
import Ajv from 'ajv';
import {parseCompactPresentationRecord} from './presentation-compact.mjs';
import {parsePresentationRecord} from './presentation-records.mjs';
const idPattern=/^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const referenceSchema={type:'object',additionalProperties:false,required:['base','assetId','sha256'],properties:{base:{const:'reuse'},assetId:{type:'string',pattern:idPattern.source},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}};
const validateReference=new Ajv({strict:false}).compile(referenceSchema);
function prepareEntry(entry){
  if(!entry||typeof entry.id!=='string'||!idPattern.test(entry.id)||typeof entry.description!=='string'||!entry.description.trim()||entry.description.length>600||/[\u0000-\u001f\u007f]/u.test(entry.description))throw Error('presentation_asset_entry');
  const raw=JSON.stringify(entry.record),record=parsePresentationRecord(raw);
  if(record.mode!=='compose'||record.payload.base!=='none'||record.payload.removePartIds!==undefined)throw Error('presentation_asset_replacement');
  return {id:entry.id,description:entry.description,raw,sha256:createHash('sha256').update(raw).digest('hex')};
}
function decode(text,entries){
  if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw Error('presentation_asset_record_size');
  const value=JSON.parse(text);
  if(value?.base!=='reuse')return parseCompactPresentationRecord(text);
  if(!validateReference(value))throw Error('presentation_asset_reference');
  const entry=entries.get(value.assetId);
  if(!entry||entry.sha256!==value.sha256)throw Error('presentation_asset_identity');
  return {...parsePresentationRecord(entry.raw),assetProvenance:{id:entry.id,sha256:entry.sha256}};
}
/** Immutable geometry only. The caller still owns source admission, lease and cancellation. */
export function createPresentationAssetLibrary(values){
  if(!Array.isArray(values)||values.length<1||values.length>8)throw Error('presentation_asset_capacity');
  const entries=new Map();let bytes=0;
  for(const value of values){const entry=prepareEntry(value);bytes+=Buffer.byteLength(entry.raw);
    if(entries.has(entry.id)||bytes>131072)throw Error('presentation_asset_capacity');entries.set(entry.id,entry);}
  const catalog=Object.freeze([...entries.values()].map(({id,description,sha256})=>Object.freeze({id,description,sha256})));
  const policy=['Optional local reusable geometry assets: '+JSON.stringify(catalog),
    'You may return exactly one reuse reference matching '+JSON.stringify(referenceSchema)+'. This selects a complete reviewed visual performance, not old conversation or authority. No overrides or inferred historical context.',
    'Choose reuse only when the described appearance and finite motion faithfully fit the current public communicative intent. A playful flourish can accompany explicit playful conversation; it is not evidence of an observed feeling or understanding. Retain and fresh compact composition remain equally available. Do not force a catalog match or use an emotion/keyword mapping. Context qualifications and source authority rules remain unchanged.'].join('\n');
  return Object.freeze({catalog,policy,parseRecord:text=>decode(text,entries)});
}

