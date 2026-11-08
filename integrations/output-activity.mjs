export function assistantText(text) {
  const clean = String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-16000);
  const lines = clean.split('\n'), blocks = []; let active = false;
  for (const line of lines) {
    if (/^\s*•\s+/.test(line)) {
      active = !/^\s*•\s+(?:Ran|Running|Explored|Read|Searched|Edited|Added|Deleted|Called|Tool|Plan|Updated)\b/i.test(line);
      if (active) blocks.push(line.replace(/^\s*•\s+/, ''));
    } else if (/^\s*(?:›|❯|\$|[⠁-⣿]|GPT-|Tip:|Context|Token|Working|Thinking|└|│)/.test(line)) active = false;
    else if (active && line.trim()) blocks.push(line);
  }
  return blocks.join('\n');
}
export class OutputActivity {
  previous = ''; value = 0; lastChange = -Infinity; previousAt;
  sample(text, at, working = true) {
    const next = assistantText(text), dt = this.previousAt === undefined ? 100 : Math.max(1, at - this.previousAt);
    this.previousAt = at;
    const added = working && this.previous && next.startsWith(this.previous) ? next.length - this.previous.length : 0;
    if (added > 0) { this.lastChange = at; this.value += (Math.min(1, added / dt * 15) - this.value) * 0.65; }
    else this.value *= Math.exp(-dt / 130);
    if (at - this.lastChange >= 600) this.value = 0;
    this.previous = next;
    return Math.max(0, Math.min(1, this.value));
  }
}
