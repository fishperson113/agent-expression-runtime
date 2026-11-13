// Deliberately small display subset: no HTML, links, images or executable content.
const cache = new WeakMap<HTMLElement, string>();
function inline(text: string, parent: Node) {
  const pattern = /(?<!`)(`)([^`\n]+)`(?!`)|\*\*([^*\n]+)\*\*/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    parent.appendChild(document.createTextNode(text.slice(start, match.index)));
    const node = document.createElement(match[2] === undefined ? 'strong' : 'code');
    node.textContent = match[2] ?? match[3]; parent.appendChild(node);
    start = match.index! + match[0].length;
  }
  parent.appendChild(document.createTextNode(text.slice(start)));
}
function formatted(text: string) {
  const output = document.createDocumentFragment();
  const pattern = /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?=\r?\n|$)/gm;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    inline(text.slice(start, match.index), output);
    const pre = document.createElement('pre'), code = document.createElement('code');
    code.textContent = match[1]; pre.append(code); output.append(pre);
    start = match.index! + match[0].length;
  }
  inline(text.slice(start), output);
  return output;
}
export function formatCompletedMessage(node: HTMLElement, text: string, completed: boolean) {
  if (cache.get(node) === text && completed) return true;
  cache.delete(node);
  if (!completed) return false;
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed && selection.containsNode(node, true)) return false;
  const prefix = text.startsWith('Codex: ') ? 'Codex: ' : '';
  const body = text.slice(prefix.length);
  if ((body.match(/^```/gm)?.length ?? 0) % 2 !== 0) return false;
  const content = formatted(body);
  content.prepend(document.createTextNode(prefix));
  if (!content.querySelector('strong, code')) return false;
  node.replaceChildren(content); cache.set(node, text); return true;
}
