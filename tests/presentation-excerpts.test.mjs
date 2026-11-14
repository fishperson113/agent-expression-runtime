import {it,expect} from 'vitest';
import {PublicTextExcerpts} from '../integrations/presentation-excerpts.mjs';
const a='A data pipeline can load one source with a small script when its volume and recovery needs remain simple.';
const b='Several dependent data sources may need coordinated recovery and explicit ownership rather than a bigger tool.';
const base={documentId:'d',threadId:'h',turnId:'t',messageId:'m',at:1000,completed:false};
it('only selects completed one-line prose and preserves exact source',()=>{
 const e=new PublicTextExcerpts();expect(e.update({...base,text:a}).checkpoint).toBeNull();expect(e.update({...base,text:a+'\n'}).checkpoint).toBeNull();
 const cp=e.update({...base,text:a+'\n\n',at:1200}).checkpoint;expect(cp.target).toBe(a);expect(cp.sourceAt).toBe(1200);expect(cp.textPrefix).toBe(a);
});
it('latest complete paragraph wins and all exact quotes retain first-seen times',()=>{
 const e=new PublicTextExcerpts();const cp=e.update({...base,text:a+'\n\n'+b+'\n\n'}).checkpoint;expect(cp.target).toBe(b);
 expect(e.update({...base,at:4000,text:a+'\n\n'+b+'\n\n'+a+'\n\n'}).checkpoint.sourceAt).toBe(1000);
 expect(e.update({...base,at:9000,text:a+'\n\n'+b+'\n\n'+a+'\n\n'+b+'\n\n'}).checkpoint).toBeNull();
});
it('skips fences headings multiline and incomplete sentences',()=>{
 for(const text of ['```txt\n'+a+'\n\n```\n\n','# '+a+'\n\n','**'+a+'**\n\n',a+'\n'+b+'\n\n',a.slice(0,-1)+'\n\n'])expect(new PublicTextExcerpts().update({...base,text,completed:true}).checkpoint).toBeNull();
 expect(new PublicTextExcerpts().update({...base,text:a,completed:true}).checkpoint.target).toBe(a);
});
it('resets identity on rewrite/new turn; correction markers revoke even split across chunks',()=>{
 const e=new PublicTextExcerpts();e.update({...base,text:a+'\n\n'});
 const r=e.update({...base,text:b+'\n\n',at:3000});expect(r.reason).toBe('text_corrected');expect(r.checkpoint.sourceAt).toBe(3000);
 expect(e.update({...base,turnId:'new',text:a,completed:true,at:5000}).checkpoint.sourceAt).toBe(5000);
 e.update({...base,turnId:'new',text:a+'\n\nđính '});const correction=e.update({...base,turnId:'new',text:a+'\n\nđính chính: '+b});expect(correction.revoked).toBe(true);expect(correction.checkpoint).toBeNull();
});

it('caps unique intake without evicting old quotes or renewing their time',()=>{
 const e=new PublicTextExcerpts();e.update({...base,text:a+'\n\n'});
 for(let i=0;i<255;i++)e.firstSeen.set('reserved-'+i,1);
 expect(e.update({...base,at:8000,text:a+'\n\n'+b+'\n\n'}).checkpoint).toBeNull();expect(e.firstSeen.size).toBe(256);expect(e.firstSeen.get(a)).toBe(1000);
 expect(e.update({...base,at:9000,text:a+'\n\n'+b+'\n\n'+a+'\n\n'}).checkpoint).toBeNull();
});

it('fails closed on backwards clock without renewing first-seen source age',()=>{
 const e=new PublicTextExcerpts();e.update({...base,text:a+'\n\n',at:2000});
 const back=e.update({...base,text:a+'\n\n'+b+'\n\n',at:1000});expect(back.revoked).toBe(true);expect(back.reason).toBe('clock_regressed');expect(back.checkpoint).toBeNull();
 expect(e.firstSeen.get(a)).toBe(2000);expect(e.update({...base,text:a+'\n\n',at:2500}).checkpoint).toBeNull();
});
