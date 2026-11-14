// Conservative public-text section watermark. This is syntactic, not semantic understanding.
export function presentationSection(text) {
  let fence=null,anchor=0,offset=0;
  for(const line of text.split('\n').slice(0,-1)) {
    const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;}
    else if(!fence&&(/^[#]{1,6}\s+\S/.test(line)||/^\*\*[^*\n]{1,300}\*\*\s*$/.test(line)))anchor=offset;
    offset+=line.length+1;
  }return anchor;
}
