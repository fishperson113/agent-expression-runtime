import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter,once} from 'node:events';
import {spawn} from 'node:child_process';
import {stopChild} from '../scripts/start-session.mjs';

const child = () => Object.assign(new EventEmitter(),{
 pid:4321,exitCode:null,signalCode:null,kill:vi.fn(),
});
function windows(target=child()) {
 const killer=new EventEmitter(),spawnProcess=vi.fn(()=>killer);
 const running=stopChild(target,{platform:'win32',spawnProcess});
 return {target,killer,spawnProcess,running};
}
function outcome(promise) {
 let result={state:'pending'};
 const done=promise.then(()=>{result={state:'resolved'};},error=>{result={state:'rejected',message:error.message};});
 return {get:()=>result,done};
}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());

describe('owned child complete shutdown deadline',()=>{
 it('observes the timeout immediately while Windows taskkill remains pending',async()=>{
  const route=windows(),result=outcome(route.running);
  await vi.advanceTimersByTimeAsync(9999);expect(result.get().state).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);await result.done;
  expect(result.get()).toEqual({state:'rejected',message:'Child shutdown timed out.'});
  expect(route.target.listenerCount('exit')).toBe(0);expect(vi.getTimerCount()).toBe(0);
  route.killer.emit('exit',0);
  expect(route.killer.listenerCount('error')).toBe(0);
 });
 it('does not wait forever when target exits but taskkill hangs',async()=>{
  const route=windows(),result=outcome(route.running);route.target.emit('exit',0);
  await vi.advanceTimersByTimeAsync(9999);expect(result.get().state).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);await result.done;
  expect(result.get().message).toBe('Child shutdown timed out.');
  route.killer.emit('exit',0);
 });
 it('requires both target exit and successful process-tree helper completion',async()=>{
  const route=windows(),result=outcome(route.running);route.target.emit('exit',0);
  await vi.advanceTimersByTimeAsync(5);expect(result.get().state).toBe('pending');
  route.killer.emit('exit',0);await result.done;
  expect(result.get().state).toBe('resolved');expect(vi.getTimerCount()).toBe(0);
  expect(route.spawnProcess).toHaveBeenCalledWith('taskkill',['/PID','4321','/T','/F'],
   {windowsHide:true,stdio:'ignore'});
  expect(route.target.listenerCount('exit')).toBe(0);
  expect(route.killer.listenerCount('exit')).toBe(0);
 });
 it('still waits for target exit when taskkill finishes first',async()=>{
  const route=windows(),result=outcome(route.running);route.killer.emit('exit',0);
  await vi.advanceTimersByTimeAsync(20);expect(result.get().state).toBe('pending');
  route.target.emit('exit',0);await result.done;expect(result.get().state).toBe('resolved');
 });
 it('accepts nonzero helper completion after independently observed target exit',async()=>{
  const route=windows(),result=outcome(route.running);route.target.emit('exit',0);
  route.killer.emit('exit',1);await result.done;
  expect(result.get().state).toBe('resolved');
  expect(vi.getTimerCount()).toBe(0);expect(route.target.listenerCount('exit')).toBe(0);
 });
 it('observes a helper error delivered after the aggregate timeout',async()=>{
  const route=windows(),result=outcome(route.running);
  await vi.advanceTimersByTimeAsync(10000);await result.done;
  expect(result.get().message).toBe('Child shutdown timed out.');
  route.killer.emit('error',Error('late private helper failure'));
  await vi.advanceTimersByTimeAsync(1);
  expect(route.killer.listenerCount('error')).toBe(0);
  expect(result.get().message).toBe('Child shutdown timed out.');
 });
 it('propagates helper spawn failure and removes target listener and timer',async()=>{
  const target=child(),spawnProcess=vi.fn(()=>{throw Error('spawn failed');});
  await expect(stopChild(target,{platform:'win32',spawnProcess})).rejects.toThrow('spawn failed');
  expect(target.listenerCount('exit')).toBe(0);expect(vi.getTimerCount()).toBe(0);
 });
 it('does not turn a helper error into success while the target remains alive',async()=>{
  const route=windows(),result=outcome(route.running);
  await vi.advanceTimersByTimeAsync(12);route.killer.emit('error',Error('helper unavailable'));
  await vi.advanceTimersByTimeAsync(9987);expect(result.get().state).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);await result.done;
  expect(result.get().message).toBe('Child shutdown timed out.');expect(vi.getTimerCount()).toBe(0);
 });
 it('accepts target exit after a nonzero helper result, but not before the exit',async()=>{
  const route=windows(),result=outcome(route.running);route.killer.emit('exit',128);
  await vi.advanceTimersByTimeAsync(10);expect(result.get().state).toBe('pending');
  route.target.emit('exit',0);await result.done;expect(result.get().state).toBe('resolved');
 });
 it('still times out a live target after nonzero helper completion',async()=>{
  const route=windows(),result=outcome(route.running);route.killer.emit('exit',128);
  await vi.advanceTimersByTimeAsync(10000);await result.done;
  expect(result.get().message).toBe('Child shutdown timed out.');
 });
 it('preserves original helper-error behavior when target exit is independently observed',async()=>{
  const route=windows(),result=outcome(route.running);route.killer.emit('error',Error('helper unavailable'));
  route.target.emit('exit',0);await result.done;expect(result.get().state).toBe('resolved');
 });
 it('preserves Unix process-group SIGTERM and waits for exit',async()=>{
  const target=child();target.aerProcessGroup=true;const killGroup=vi.fn();
  const running=stopChild(target,{platform:'linux',killGroup}),result=outcome(running);
  expect(killGroup).toHaveBeenCalledWith(-4321,'SIGTERM');expect(target.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4);expect(result.get().state).toBe('pending');
  target.emit('exit',null,'SIGTERM');await result.done;expect(result.get().state).toBe('resolved');
  expect(vi.getTimerCount()).toBe(0);
 });
 it('preserves direct Unix child SIGTERM and its failure',async()=>{
  const target=child();const running=stopChild(target,{platform:'linux'});
  expect(target.kill).toHaveBeenCalledWith('SIGTERM');target.emit('exit',0);await running;
  const broken=child();broken.kill.mockImplementation(()=>{throw Error('kill failed');});
  await expect(stopChild(broken,{platform:'linux'})).rejects.toThrow('kill failed');
  expect(broken.listenerCount('exit')).toBe(0);expect(vi.getTimerCount()).toBe(0);
 });
 it('times out a Unix child that never exits',async()=>{
  const target=child(),result=outcome(stopChild(target,{platform:'linux'}));
  await vi.advanceTimersByTimeAsync(10000);await result.done;
  expect(result.get().message).toBe('Child shutdown timed out.');
  expect(target.listenerCount('exit')).toBe(0);
 });
 it('does nothing for absent or already-exited children',async()=>{
  const spawnProcess=vi.fn();
  for(const target of [undefined,{pid:4321,exitCode:0,signalCode:null},{pid:4321,exitCode:null,signalCode:'SIGTERM'}])
   await stopChild(target,{platform:'win32',spawnProcess});
  expect(spawnProcess).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
});

async function realChild() {
 const target=spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>process.exit(0));process.stdout.write('ready');"],
  {windowsHide:true,stdio:['pipe','pipe','ignore']});
 try {await once(target.stdout,'data',{signal:AbortSignal.timeout(3000)});return target;}
 catch(error){target.kill('SIGKILL');throw error;}
}
function tracedKiller(trace) {
 return (command,args,options)=>{
  const at=performance.now(),helper=spawn(command,args,options);
  helper.once('exit',(code,signal)=>trace.push({helperCode:code,helperSignal:signal,elapsedMs:performance.now()-at}));
  return helper;
 };
}
for(const concurrent of [false,true]) {
 it.skipIf(process.platform!=='win32')(`handles actual Windows ${concurrent?'overlapping owned stops':'stdin-end natural exit'}`,async()=>{
  vi.useRealTimers();const target=await realChild(),trace=[],spawnProcess=tracedKiller(trace);
  try {
   const started=performance.now();
   if(concurrent)await Promise.all([stopChild(target,{spawnProcess}),stopChild(target,{spawnProcess})]);
   else {target.stdin.end();await stopChild(target,{spawnProcess});}
   expect(target.exitCode!==null||target.signalCode!==null).toBe(true);
   expect(trace.length).toBe(concurrent?2:1);
   console.info('child-shutdown-real',JSON.stringify({case:concurrent?'overlap':'stdin-end',
    elapsedMs:performance.now()-started,trace,targetExitCode:target.exitCode,targetSignalCode:target.signalCode}));
  } finally {if(target.exitCode===null&&target.signalCode===null)target.kill('SIGKILL');}
 },15000);
}
