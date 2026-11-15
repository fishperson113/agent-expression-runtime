import {it,expect} from 'vitest';
import {preparedDiagramIdentity,matchingDiagramStatus} from '../src/live/prepared-diagram';
it('bounds source age by both clocks and never refreshes original TTL',()=>{
 const v={identity:{sourceQuote:'x'},sentWall:1000,expiresAt:5000,monotonicDeadline:4500,remainingMs:4000};
 expect(preparedDiagramIdentity(v,2000,3000)).toEqual({sourceQuote:'x',remainingTtlMs:1500});
 for(const pair of [[900,3000],[2000,4500],[5000,3000],[NaN,3000]])expect(preparedDiagramIdentity(v,...pair)).toBeNull();
});
it('visible receipt must match exact rendered ownership, never stale geometry',()=>{
 const owned={epoch:'e',sceneRevision:2,seq:3},status={current:true,owned,visible:true,visibleElapsedMs:2500,remainingMs:3000};
 expect(matchingDiagramStatus(owned,status)).toMatchObject({current:true,visible:true,visibleElapsedMs:2500});
 for(const changed of [{...owned,epoch:'other'},{...owned,sceneRevision:3},{...owned,seq:4}])expect(matchingDiagramStatus(changed,status)).toEqual({current:false});
 expect(matchingDiagramStatus(owned,{...status,current:false})).toEqual({current:false});
});
