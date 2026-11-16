import { types } from 'node:util';
const fields = ['userText', 'target', 'publicContext', 'assistantText'];
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key);
const invalid = () => { throw Error('presentation_asset_job_invalid'); };
function bytes(value, budget) {
  if (typeof value === 'string' && value.length > 65536) invalid();
  budget.bytes += Buffer.byteLength(JSON.stringify(value));
  if (budget.bytes > 65536) invalid();
}
function jsonCopy(value, depth = 0, seen = new Set(), budget = { nodes: 0, bytes: 0 }) {
  if (depth > 32 || ++budget.nodes > 16384) invalid();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') { bytes(value, budget); return value; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); bytes(value, budget); return value; }
  if (!value || typeof value !== 'object' || seen.has(value)) invalid();
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (!array && proto !== Object.prototype && proto !== null) invalid();
  budget.bytes += 2; let entries = 0;
  seen.add(value); const copy = array ? [] : Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string' || array && !/^(?:0|[1-9][0-9]*)$/u.test(key)) invalid();
    if (entries++) budget.bytes++;
    if (!array) { bytes(key, budget); budget.bytes++; }
    const descriptor = own(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid();
    Object.defineProperty(copy, key, { value: jsonCopy(descriptor.value, depth + 1, seen, budget), enumerable: true });
  }
  if (array && copy.length !== value.length || array && Object.keys(copy).length !== value.length) invalid();
  seen.delete(value); return Object.freeze(copy);
}
export function bindAssetJob(library, exchange) {
  if (!library || library.createJob === undefined) return null;
  if (!exchange || typeof exchange !== 'object') invalid();
  const snapshot = {};
  for (const key of fields) {
    const descriptor = own(exchange, key);
    if (!descriptor && key === 'assistantText') continue;
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') invalid();
    snapshot[key] = descriptor.value;
  }
  const job = library.createJob(Object.freeze(snapshot));
  if (types.isPromise(job)) { Promise.prototype.then.call(job, undefined, () => {}); invalid(); }
  if (!job || typeof job !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(job)) || 'then' in job) invalid();
  const parser = own(job, 'parseRecord'), data = own(job, 'input');
  if (!parser || typeof parser.value !== 'function' || !data || !Object.hasOwn(data, 'value') || !data.value || Array.isArray(data.value) || typeof data.value !== 'object') invalid();
  const input = jsonCopy(data.value);
  if (Buffer.byteLength(JSON.stringify(input)) > 65536) invalid();
  const binding = Object.freeze({ parseRecord: parser.value, input });
  return Object.freeze({ parseRecord: parser.value.bind(binding), input });
}
