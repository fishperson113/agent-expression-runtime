import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createPresentationAssetLibrary} from './presentation-assets.mjs';

export const PROFILE = 'fisch-setfit-v1';
export const LABELS = Object.freeze(['a01', 'a02', 'a03']);
const PINS = Object.freeze({
 model: ['model.onnx', '1872f23f0a8ce0eedc8495aa161616242351cae0a0327470d243419ec8aa4f7c', 512*1024*1024],
 head: ['selector.json', '1d462d9dcdf1f45eb02c6db2c6e1876100f8e7909c74069afa12f7a95716375b', 131072],
 tokenizer: ['tokenizer.json', 'cad551d5600a84242d0973327029452a1e3672ba6313c2a3c3d69c4310e12719', 24*1024*1024],
 tokenizerConfig: ['tokenizer_config.json', 'f469534f4662884f6a1f5ff2a5fe70cbc6dc4a8c34c1fa765d2f022ea9a0ac12', 16384],
 assets: ['assets.json', 'b56cc873e52484073da80544cac14e8dd15b866f156e96432eb7fc40f70b7198', 262144],
});
const ASSETS = ['1a306a8e8224c19bc0f3613a2c74c43053b657180c7f37f044c361097a3e7892',
 'b300b59927c1b687d2e1ef8c57cdf9ccd7be3e9cb12b67eab8d15cb8527e4978',
 '516d6788db203b140449cb23a4d98f3e122f9c67a8ee323250927f5912e0edbd'];
const TEMPLATE = 'Public context:\n{publicContext}\nCurrent text:\n{target}';
export const sourceHash = text => createHash('sha256').update(text).digest('hex');
export function exactKeys(value, keys) {
 return !!value && !Array.isArray(value) && typeof value === 'object' &&
 Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function localFile(file, limit) {
 if (typeof file !== 'string' || !path.isAbsolute(file) || /^[\\\\/]{2}/.test(file) || file.includes('\0')) throw Error('selector_path');
 const stat = fs.lstatSync(file);
 if (stat.isSymbolicLink() || !stat.isFile() || stat.size > limit) throw Error('selector_file');
 return file;
}
export async function selectorFileDigest(file, signal) {
 signal?.throwIfAborted();
 const hash = createHash('sha256'), stream=fs.createReadStream(file,{signal});
 const closed=new Promise(resolve=>stream.once('close',resolve));
 try {
  for await (const chunk of stream) {signal?.throwIfAborted();hash.update(chunk);}
  signal?.throwIfAborted();return hash.digest('hex');
 } finally {stream.destroy();await closed;}
}
export async function readSelectorBundle(manifestPath, {signal}={}) {
 try {
  signal?.throwIfAborted();localFile(manifestPath, 8192);
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, {encoding:'utf8',signal}));
  if (!exactKeys(manifest, ['schemaVersion','profile','files']) || manifest.schemaVersion !== 1 ||
      manifest.profile !== PROFILE || !exactKeys(manifest.files, Object.keys(PINS))) throw Error('manifest');
  const root = fs.realpathSync(path.dirname(manifestPath)), files = {};
  for (const [key, [name, hash, cap]] of Object.entries(PINS)) {
   signal?.throwIfAborted();const entry = manifest.files[key];
   if (!exactKeys(entry, ['file','sha256']) || entry.file !== name || entry.sha256 !== hash) throw Error('pin');
   const file = localFile(path.join(root, name), cap);
   if (await selectorFileDigest(file,signal) !== hash) throw Error('hash');
   files[key] = file;
  }
  signal?.throwIfAborted();
  const assets = JSON.parse(await fs.promises.readFile(files.assets, {encoding:'utf8',signal})).assets;
  if (!Array.isArray(assets) || assets.length !== 3) throw Error('assets');
  const entries = LABELS.map((id, i) => {
   const a = assets[i];
   if (a.id !== id || a.sha256 !== ASSETS[i] || sourceHash(JSON.stringify(a.record)) !== ASSETS[i]) throw Error('asset');
   return {id, record:a.record, description:a.id};
  });
  signal?.throwIfAborted();return {files, library:createPresentationAssetLibrary(entries)};
 } catch { throw Error('selector_bundle_invalid'); }
}
export function selectorText(input) {
 if (!exactKeys(input, ['publicContext','target']) || typeof input.publicContext !== 'string' ||
     typeof input.target !== 'string' || !input.target.trim()) throw Error('selector_input');
 const text = 'Public context:\n'+input.publicContext+'\nCurrent text:\n'+input.target;
 if (Buffer.byteLength(text) > 32768) throw Error('selector_input_size');
 return text;
}
export function encodeSelector(tokenizer, input) {
 const text = selectorText(input), value = tokenizer.encode(text, {add_special_tokens:true});
 const ids = value.ids;
 if (!Array.isArray(ids) || ids.length < 2 || ids.some(x=>!Number.isSafeInteger(x)||x<0||x>=250037) ||
     ids[0] !== 0 || ids.at(-1) !== 2) throw Error('selector_tokens');
 if (ids.length > 128) throw Error('selector_too_long');
 return {ids, mask:ids.map(()=>1), text};
}
export function selectorDecision(head, embedding) {
 if (!head || JSON.stringify(head.labelOrder) !== JSON.stringify(LABELS) ||
     JSON.stringify(head.thresholds) !== '[0.5,0.6,0.5]' || head.coefficients?.length !== 3 ||
     head.intercepts?.length !== 3 || embedding.length !== 384 || [...embedding].some(x=>!Number.isFinite(x))) throw Error('selector_head');
 const probabilities = head.coefficients.map((weights,i) => {
  if (!Array.isArray(weights) || weights.length !== 384 || weights.some(x=>!Number.isFinite(x)) ||
      !Number.isFinite(head.intercepts[i])) throw Error('selector_head');
  let z = head.intercepts[i];
  for (let j=0;j<384;j++) z += weights[j]*embedding[j];
  if (!Number.isFinite(z)) throw Error('selector_head');
  return z >= 0 ? 1/(1+Math.exp(-z)) : Math.exp(z)/(1+Math.exp(z));
 });
 return {probabilities, selected:LABELS.filter((_,i)=>probabilities[i]>=head.thresholds[i])};
}
function runtimeModules(directory) {
 if (typeof directory !== 'string' || !path.isAbsolute(directory) || /^[\\\\/]{2}/.test(directory)) throw Error('selector_runtime_path');
 const root = fs.realpathSync(directory), require = createRequire(path.join(root, 'package.json'));
 const lock = fs.readFileSync(localFile(path.join(root, 'package-lock.json'), 1048576));
 const expected = fs.readFileSync(new URL('./selector/package-lock.json', import.meta.url));
 if (sourceHash(lock) !== sourceHash(expected)) throw Error('selector_runtime_lock');
 for (const [name,version] of [['onnxruntime-node','1.31.1'],['@huggingface/tokenizers','0.2.0']]) {
  const file = path.join(root,'node_modules',name,'package.json');
  if (JSON.parse(fs.readFileSync(localFile(file,65536),'utf8')).version !== version) throw Error('selector_runtime_version');
  const resolved = fs.realpathSync(require.resolve(name));
  if (!resolved.startsWith(root+path.sep)) throw Error('selector_runtime_path');
 }
 return {ort:require('onnxruntime-node'), Tokenizer:require('@huggingface/tokenizers').Tokenizer};
}
const TOKEN_CONTROLS = [{"ids":[0,16934,43701,12,135809,2872,11260,5208,6996,5,114063,7986,12,6,208240,11,8707,1617,17767,9246,392,6,230846,29337,57679,34010,32,2],"input":{"publicContext":"\u0110ang n\u00f3i chuy\u1ec7n t\u1ef1 nhi\u00ean.","target":"\u1ee6a c\u00e1 n\u00e0y d\u1ec5 th\u01b0\u01a1ng \u00e1 \ud83d\ude04 c\u00e0 ph\u00ea nh\u00e9?"}},{"ids":[0,16934,43701,12,87293,45252,70,165523,8,13158,53,674,5,114063,7986,12,984,959,176016,12,12765,7,765,959,115081,14373,5,2],"input":{"publicContext":"Only discuss the failed deployment.","target":"Do not celebrate: checks have not passed yet."}}];
function tokenizerPreflight(tokenizer) {
 for (const check of TOKEN_CONTROLS) {
  if (JSON.stringify(encodeSelector(tokenizer,check.input).ids)!==JSON.stringify(check.ids)) throw Error('selector_tokenizer_parity');
 }
 let rejected=false;
 try { encodeSelector(tokenizer,{publicContext:'',target:'token '.repeat(1000)}); }
 catch(error) { if(error.message==='selector_too_long')rejected=true;else throw error; }
 if(!rejected)throw Error('selector_tokenizer_truncation');
}
function modelContract(head) {
 if (head.formatVersion !== 1 || head.modelSHA256 !== PINS.model[1] || head.maxTokens !== 128 ||
     head.onOversize !== 'abstain_without_inference' || head.normalization !== false ||
     head.template !== TEMPLATE || head.output !== 'sentence_embedding:float32[batch,384]') throw Error('selector_head');
 selectorDecision(head, Array(384).fill(0));
}
export async function loadSelectorEngine(manifestPath, runtimeDirectory) {
 const bundle = await readSelectorBundle(manifestPath);
 let session;
 try {
  const head = JSON.parse(fs.readFileSync(bundle.files.head,'utf8')); modelContract(head);
  const raw = JSON.parse(fs.readFileSync(bundle.files.tokenizer,'utf8'));
  const config = JSON.parse(fs.readFileSync(bundle.files.tokenizerConfig,'utf8'));
  raw.truncation = null; raw.padding = null;
  for (const k of ['max_length','model_max_length','truncation_strategy','truncation_side']) delete config[k];
  const {ort,Tokenizer} = runtimeModules(runtimeDirectory), tokenizer = new Tokenizer(raw,config);
  tokenizerPreflight(tokenizer);
  session = await ort.InferenceSession.create(bundle.files.model,{executionProviders:['cpu'],intraOpNumThreads:2,
   interOpNumThreads:1,graphOptimizationLevel:'all'});
  if (JSON.stringify([...session.inputNames].sort()) !== '["attention_mask","input_ids"]' ||
      !session.outputNames.includes('sentence_embedding')) throw Error('abi');
  return createSelectorEngine({session,ort,tokenizer,head});
 } catch { await session?.release(); throw Error('selector_runtime_unavailable'); }
}
export function createSelectorEngine({session,ort,tokenizer,head}) {
 let busy=false, closed=false;
 return {
  async score(input) {
   if (busy||closed) throw Error('selector_unavailable');
   busy=true;
   try {
    const at=performance.now(), v=encodeSelector(tokenizer,input), encoded=performance.now();
    const shape=[1,v.ids.length], tensor=x=>new ort.Tensor('int64',BigInt64Array.from(x,BigInt),shape);
    const out=await session.run({input_ids:tensor(v.ids),attention_mask:tensor(v.mask)});
    const e=out.sentence_embedding;
    if (!e || e.type!=='float32' || JSON.stringify(e.dims)!=='[1,384]') throw Error('selector_embedding');
    return {...selectorDecision(head,e.data),tokens:v.ids.length,sourceHash:sourceHash(v.text),
     timing:{tokenizeMs:encoded-at,inferenceAndHeadMs:performance.now()-encoded,totalMs:performance.now()-at}};
   } finally { busy=false; }
  },
  async close() { if (busy) throw Error('selector_busy'); if (!closed) {closed=true;await session.release();} },
 };
}
export function serveSelectorWorker(engine, port=process) {
 let active=null, closing=false, shutdownPromise;
 const send=value=>{if(port.connected)port.send?.(value);};
 const shutdown=()=> {
  if(active) return;
  return shutdownPromise??=(async()=>{await engine.close();send({type:'closed'});if(port.connected)port.disconnect();})()
   .catch(()=>{if(port.connected)port.disconnect();});
 };
 const receive=async message=>{
  if(exactKeys(message,['type'])&&message.type==='close'){closing=true;await shutdown();return;}
  if(exactKeys(message,['type','id'])&&message.type==='cancel'){if(active?.id===message.id)active.cancelled=true;return;}
  if(!exactKeys(message,['type','id','input'])||message.type!=='score'||typeof message.id!=='string'||
      !/^[a-zA-Z0-9-]{1,80}$/.test(message.id)){send({type:'fatal',code:'selector_protocol'});closing=true;await shutdown();return;}
  if(active||closing){send({type:'fatal',code:'selector_protocol'});closing=true;await shutdown();return;}
  const job=active={id:message.id,cancelled:false};
  try {
   const result=await engine.score(message.input);
   send(job.cancelled?{type:'cancelled',id:job.id}:{type:'result',id:job.id,result});
  } catch(error) {
   const code=['selector_too_long','selector_input','selector_input_size'].includes(error.message)?error.message:'selector_inference';
   send({type:'error',id:job.id,code});
  } finally { active=null;if(closing)await shutdown(); }
 };
 port.on('message',receive);
 port.on('disconnect',()=>{closing=true;if(active)active.cancelled=true;else void shutdown();});
 send({type:'ready',profile:PROFILE});
}
async function workerMain() {
 let abandoned=!process.connected;
 const disconnected=()=>{abandoned=true;};
 const early=message=>{if(message?.type==='close')abandoned=true;};
 process.on('disconnect',disconnected);process.on('message',early);
 try {
  const engine=await loadSelectorEngine(process.argv[3],process.argv[4]);
  process.removeListener('disconnect',disconnected);process.removeListener('message',early);
  if(abandoned||!process.connected){await engine.close();if(process.connected)process.disconnect();return;}
  serveSelectorWorker(engine);
 } catch {
  if(process.connected){process.send({type:'fatal',code:'selector_startup'});process.disconnect();}
  process.exitCode=1;
 }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url) &&
    process.argv[2]==='--internal-selector-worker') await workerMain();
