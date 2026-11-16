import { it, expect, vi } from 'vitest';
import { LiveStreamingPresentationBridge } from '../integrations/presentation-streaming-bridge.mjs';
import { closePresentation, closeLiveOwned } from '../integrations/live-shutdown.mjs';

function bridge(provider) {
  return new LiveStreamingPresentationBridge({state:{channel:{token:'d'},output:{thread:'t'}},
    page:{evaluate:async()=>null},provider});
}
it('fences and aborts active author synchronously, then awaits provider once',async()=>{
  const done=Promise.withResolvers(), provider={close:vi.fn(()=>done.promise)};
  const b=bridge(provider), controller=new AbortController(); b.active={controller};
  const first=b.close(); expect(b.closed).toBe(true); expect(controller.signal.aborted).toBe(true);
  expect(b.close()).toBe(first); expect(provider.close).toHaveBeenCalledTimes(1);
  let settled=false;first.then(()=>settled=true);await Promise.resolve();expect(settled).toBe(false);
  done.resolve();await first;expect(settled).toBe(true);
});
it.each(['throw','reject'])('caches provider %s failure and immediately observes it',async mode=>{
  const error=Error('close_failure'),provider={close:vi.fn(()=>{if(mode==='throw')throw error;return Promise.reject(error);})};
  const b=bridge(provider),first=b.close();await new Promise(r=>setImmediate(r));
  expect(b.close()).toBe(first);await expect(first).rejects.toBe(error);expect(provider.close).toHaveBeenCalledTimes(1);
});
it('attempts provider settlement even if invalidation fails, preserving first failure',async()=>{
  const first=Error('invalidate'),done=Promise.withResolvers(),provider={close:vi.fn(()=>done.promise)};
  const b=bridge(provider);b.invalidate=()=>{throw first;};const closing=b.close();
  expect(provider.close).toHaveBeenCalledTimes(1);done.reject(Error('provider'));
  await expect(closing).rejects.toBe(first);
});
it('dedicated close joins once while other cleanup owners run despite failure',async()=>{
  const failure=Error('visual'),presentation={close:vi.fn(()=>Promise.reject(failure))},state={presentation};
  const first=closePresentation(state);await new Promise(r=>setImmediate(r));expect(closePresentation(state)).toBe(first);
  const other=vi.fn();await expect(closeLiveOwned([()=>closePresentation(state),other])).rejects.toThrow('live_cleanup_failed');
  expect(other).toHaveBeenCalledTimes(1);expect(presentation.close).toHaveBeenCalledTimes(1);
  await expect(closeLiveOwned([()=>first,other],true)).resolves.toBeUndefined();await expect(first).rejects.toBe(failure);
});
it('dedicated helper retains synchronous errors and no-provider shutdown',async()=>{
  const error=Error('sync'),state={presentation:{close(){throw error;}}};
  const first=closePresentation(state);expect(closePresentation(state)).toBe(first);await expect(first).rejects.toBe(error);
  await expect(closePresentation({})).resolves.toBeUndefined();
});

it('cancels an actual drain generate and waits its provider retirement',async()=>{
  const started=Promise.withResolvers(),generation=Promise.withResolvers(),retired=Promise.withResolvers();let signal;
  const provider={generate:vi.fn(async(_exchange,s)=>{signal=s;started.resolve();await generation.promise;}),close:vi.fn(()=>retired.promise)};
  const b=bridge(provider);b.valid=()=>!b.closed;b.remaining=()=>10000;
  b.pending={controller:new AbortController(),checkpoint:{checkpointRevision:1,sourceText:'synthetic'},scene:{scope:{epoch:'synthetic',sceneRevision:1},partIds:[]},sourceQuote:'synthetic',userText:'synthetic'};
  b.selected=b.pending;
  try {
    b.drain();await started.promise;const closing=b.close();expect(signal.aborted).toBe(true);
    generation.resolve();await vi.waitFor(()=>expect(b.active).toBe(null));
    let done=false;closing.then(()=>done=true);await Promise.resolve();expect(done).toBe(false);
    retired.resolve();await closing;expect(provider.generate).toHaveBeenCalledTimes(1);expect(provider.close).toHaveBeenCalledTimes(1);
  } finally { generation.resolve();retired.resolve();await b.close(); }
});

it.each([undefined,null])('preserves falsy invalidate failure %s over later provider failure',async failure=>{
  const b=bridge({close:()=>Promise.reject(Error('later'))});b.invalidate=()=>{throw failure;};
  const result=await b.close().then(()=>({fulfilled:true}),error=>({fulfilled:false,error}));
  expect(result).toEqual({fulfilled:false,error:failure});
});
it.each([undefined,null])('preserves falsy provider rejection %s',async failure=>{
  const b=bridge({close:()=>Promise.reject(failure)});
  const result=await b.close().then(()=>({fulfilled:true}),error=>({fulfilled:false,error}));
  expect(result).toEqual({fulfilled:false,error:failure});
});
