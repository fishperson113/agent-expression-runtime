import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, renameSync, appendFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeUsagePaths, prepareNativeUsage } from '../integrations/native-live-usage.mjs';
vi.mock('node:fs', async original => { const fs = await original(); return { ...fs, renameSync: vi.fn(fs.renameSync), appendFileSync: vi.fn(fs.appendFileSync) }; });
const roots = [];
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'fisch native usage ')); roots.push(home);
  const options = { env: { LOCALAPPDATA: home, XDG_DATA_HOME: home }, home };
  return { options, paths: nativeUsagePaths(options) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.clearAllMocks(); });
it('chooses OS data paths, including Windows drive/spaces, without reading credentials', () => {
  expect(nativeUsagePaths({ platform: 'win32', home: 'C:\\Users\\A B', env: {} }).state).toBe('C:\\Users\\A B\\AppData\\Local\\fisch\\native-live\\usage.json');
  expect(nativeUsagePaths({ platform: 'win32', home: 'C:\\Users\\A B', env: { LOCALAPPDATA: 'D:\\Local data' } }).history).toBe('D:\\Local data\\fisch\\native-live\\usage.jsonl');
  expect(nativeUsagePaths({ platform: 'darwin', home: '/Users/a b', env: {} }).state).toBe('/Users/a b/Library/Application Support/fisch/native-live/usage.json');
  expect(nativeUsagePaths({ platform: 'linux', home: '/home/a b', env: {} }).state).toBe('/home/a b/.local/share/fisch/native-live/usage.json');
  expect(() => nativeUsagePaths({ platform: 'linux', home: '/home/a', env: { XDG_DATA_HOME: 'relative' } })).toThrow('native_usage_path');
});
it('creates private usage once, keeps cumulative reservations/history across launches, and has no quota/deadline', () => {
  const { options, paths } = fixture(), first = prepareNativeUsage(options);
  expect(JSON.parse(readFileSync(paths.state))).toEqual({ schemaVersion: 1, kind: 'native-live-usage', used: 0 });
  first.reserve('request_1', 100); const before = readFileSync(paths.history, 'utf8');
  const second = prepareNativeUsage(options); expect(readFileSync(paths.history, 'utf8')).toBe(before);
  second.reserve('request_2', 200);
  expect(JSON.parse(readFileSync(paths.state)).used).toBe(2);
  const records = readFileSync(paths.history, 'utf8').trim().split('\n').map(JSON.parse);
  expect(records.slice(1).map(value => value.id)).toEqual([1, 2]); expect(records[1].purpose).toBe('native-observation:request_1');
  expect(records[0]).toEqual({ schemaVersion: 1, kind: 'native-live-usage' });
  if (process.platform !== 'win32') expect(statSync(paths.state).mode & 0o777).toBe(0o600);
});
it('refuses a competing lock without deleting it or changing state/history', () => {
  const { options, paths } = fixture(), usage = prepareNativeUsage(options);
  mkdirSync(paths.lock); const before = readFileSync(paths.history, 'utf8');
  expect(() => usage.reserve('r', 100)).toThrow(); expect(() => prepareNativeUsage(options)).toThrow();
  expect(statSync(paths.lock).isDirectory()).toBe(true); expect(readFileSync(paths.history, 'utf8')).toBe(before);
  expect(JSON.parse(readFileSync(paths.state)).used).toBe(0);
});
it('serializes two fresh-process launches without truncating history or losing a successful reservation', async () => {
  const { options, paths } = fixture(), module = new URL('../integrations/native-live-usage.mjs', import.meta.url).href;
  const code = `const {prepareNativeUsage}=await import(${JSON.stringify(module)});try{prepareNativeUsage(JSON.parse(process.argv[1])).reserve(process.argv[2],100)}catch(error){if(error.code==='EEXIST')process.exitCode=2;else throw error}`;
  const outcomes = await Promise.allSettled(['first', 'second'].map(id => promisify(execFile)(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(options), id])));
  const completed = outcomes.filter(value => value.status === 'fulfilled').length;
  expect(completed).toBeGreaterThanOrEqual(1);
  for (const outcome of outcomes) if (outcome.status === 'rejected') expect(outcome.reason.code).toBe(2);
  expect(JSON.parse(readFileSync(paths.state)).used).toBe(completed);
  const records = readFileSync(paths.history, 'utf8').trim().split('\n').slice(1).map(JSON.parse);
  expect(records.map(value => value.id)).toEqual(Array.from({ length: completed }, (_, index) => index + 1));
});
it('recovers exactly one appended reservation after state-write failure without reusing its id', () => {
  const { options, paths } = fixture(), usage = prepareNativeUsage(options);
  renameSync.mockImplementationOnce(() => { throw Error('write_failed'); });
  expect(() => usage.reserve('reserved_before_failure', 100)).toThrow('write_failed');
  expect(JSON.parse(readFileSync(paths.state)).used).toBe(0);
  expect(readFileSync(paths.history, 'utf8')).toContain('reserved_before_failure');
  prepareNativeUsage(options).reserve('next', 200);
  expect(JSON.parse(readFileSync(paths.state)).used).toBe(2);
  expect(readFileSync(paths.history, 'utf8').trim().split('\n').slice(1).map(line => JSON.parse(line).id)).toEqual([1, 2]);
});
it.each(['state', 'partial', 'old_record', 'missing_history'])('preserves corrupt %s without resetting or creating a new ledger', mode => {
  const { options, paths } = fixture(), usage = prepareNativeUsage(options); usage.reserve('one', 100); usage.reserve('two', 200);
  if (mode === 'state') writeFileSync(paths.state, '{bad');
  if (mode === 'partial') appendFileSync(paths.history, '{partial');
  if (mode === 'old_record') writeFileSync(paths.history, readFileSync(paths.history, 'utf8').replace('"id":1', '"id":9'));
  if (mode === 'missing_history') rmSync(paths.history);
  const state = readFileSync(paths.state, 'utf8'), history = mode === 'missing_history' ? null : readFileSync(paths.history, 'utf8');
  expect(() => prepareNativeUsage(options)).toThrow(); expect(readFileSync(paths.state, 'utf8')).toBe(state);
  if (history !== null) expect(readFileSync(paths.history, 'utf8')).toBe(history);
});
it('preserves a partial append and rejects subsequent reservations instead of replaying or truncating it', () => {
  const { options, paths } = fixture(), usage = prepareNativeUsage(options);
  appendFileSync.mockImplementationOnce(path => { writeFileSync(path, '{partial', { flag: 'a' }); throw Error('disk_failure'); });
  expect(() => usage.reserve('r', 100)).toThrow('disk_failure'); const before = readFileSync(paths.history, 'utf8');
  expect(() => usage.reserve('later', 200)).toThrow(); expect(readFileSync(paths.history, 'utf8')).toBe(before);
  expect(JSON.parse(readFileSync(paths.state)).used).toBe(0);
});
