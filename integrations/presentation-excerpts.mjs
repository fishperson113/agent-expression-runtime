// Opt-in public prose sampling. Syntactic evidence only, never semantic entailment.
export class PublicTextExcerpts {
  constructor(){this.reset();this.serial=0;}
  reset(){this.identity=null;this.text='';this.firstSeen=new Map();this.emitted=new Set();this.correctionEnd=0;this.lastNow=-Infinity;}
  revoke(){this.reset();}
  update(input){
    if(typeof input.text!=='string'||input.text.length>64000||!Number.isFinite(input.at))return {revoked:true,reason:'source_limit',checkpoint:null};
    const identity=JSON.stringify([input.documentId,input.threadId,input.turnId,input.messageId]);
    let reason=null;
    if(this.identity!==null&&this.identity!==identity)reason='identity_changed';
    else if(this.identity===identity&&!input.text.startsWith(this.text))reason='text_corrected';
    if(reason)this.reset();
    if(input.at<this.lastNow)return {revoked:true,reason:'clock_regressed',checkpoint:null};
    this.lastNow=input.at;this.identity=identity;
    // Scan the full public prefix so markers split across deltas are still recognized.
    const markers=[...input.text.matchAll(/(?<![\p{L}\p{N}])(?:actually|correction|đính chính|nói đúng hơn)(?![\p{L}\p{N}])/giu)];
    const correctionEnd=markers.length?markers.at(-1).index+markers.at(-1)[0].length:0;
    if(correctionEnd>this.correctionEnd){this.correctionEnd=correctionEnd;reason='explicit_correction';}
    this.text=input.text;
    const paragraphs=[];let offset=0,begin=0,lines=[],fence=null;
    const flush=(end)=>{const raw=input.text.slice(begin,end),quote=raw.trim();
      if(lines.length===1&&quote.length>=80&&quote.length<=320&&!/^\s*(?:#{1,6}\s|\*\*.*\*\*$|__.*__$)/u.test(quote)&&/[.!?]["'”’)]*$/u.test(quote)){
        const start=begin+raw.indexOf(quote);
        if(!this.firstSeen.has(quote)){if(this.firstSeen.size>=256){lines=[];return;}this.firstSeen.set(quote,input.at);}
        paragraphs.push({quote,start,end:start+quote.length,sourceAt:this.firstSeen.get(quote)});
      }lines=[];};
    for(const line of input.text.split('\n')){
      const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/u);
      if(marker){lines=[];if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;}
      else if(!fence&&/^\s*(?:#{1,6}\s|\*\*.*\*\*$|__.*__$)/u.test(line)){lines=[];begin=offset+line.length+1;}
      else if(!fence){if(!line.trim()){if(offset<input.text.length)flush(offset);begin=offset+line.length+1;}else {if(!lines.length)begin=offset;lines.push(line);}}
      offset+=line.length+1;
    }
    if(input.completed&&!fence)flush(input.text.length);
    const candidate=paragraphs.filter(p=>p.start>=this.correctionEnd).at(-1);
    if(reason==='explicit_correction'||!candidate||this.emitted.has(candidate.quote))return {revoked:!!reason,reason,checkpoint:null};
    this.emitted.add(candidate.quote);
    return {revoked:!!reason,reason,checkpoint:{...input,checkpointRevision:++this.serial,
      sourceStart:candidate.start,sourceEnd:candidate.end,previousEnd:0,sourceText:candidate.quote,target:candidate.quote,
      textPrefix:input.text.slice(0,candidate.end),sourceAt:candidate.sourceAt,observedAt:candidate.sourceAt,selectedAt:input.at}};
  }
}
