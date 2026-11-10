import { closeLiveOwned } from '../../integrations/live-shutdown.mjs';

export async function awaitResearchReady(ready, running, timeoutMs = 60000) {
  let timer;
  const ended = running.then(() => { throw Error('research_host_ended_before_ready'); },
    () => { throw Error('research_host_setup_failed'); });
  try {
    return await Promise.race([ready, ended, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('research_ready_timeout')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function closeResearchRoute(abort, child, running, hasPrimaryError = false) {
  await closeLiveOwned([() => abort.abort(), () => child?.stdin.end(), () => running], hasPrimaryError);
}
