import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PlayDeck, playCards } from '../integrations/play-deck.mjs';

const args = process.argv.slice(2);
if (args.some(arg => !['--interactive', '--plan'].includes(arg) && !/^--minutes=(10|1[1-9]|20)$/.test(arg)))
  throw Error('Use --plan or --interactive [--minutes=10..20]');
if (!args.includes('--interactive')) {
  console.log('GUIDED QA deck. Copy chosen prompts into your own Fisch conversation. No model, camera or voice is started.');
  for (const card of playCards) console.log(`${card.id}: ${card.prompt}`);
} else await interactive();

function save(deck) {
  mkdirSync('.runtime', { recursive: true });
  writeFileSync('.runtime/guided-play-session.json', JSON.stringify(deck.report(performance.now()), null, 2));
}

function action(deck, line) {
  const now = performance.now();
  if (line === 'n') console.log(deck.next(now)?.prompt ?? 'Session ended.');
  else if (['completed', 'failed', 'skipped', 'uncertain'].includes(line)) deck.record(line, now);
  else if (/^rate [1-5] [1-5]$/.test(line)) deck.rate(Number(line[5]), Number(line[7]), now);
  else if (line === 'finish') deck.finish(now);
  else if (line === 'abort') deck.finish(now, 'aborted');
  else console.log('Use n, completed, failed, skipped, uncertain, rate 1..5 1..5, finish, abort. Text is not saved.');
}

async function interactive() {
  const minutes = Number(args.find(arg => arg.startsWith('--minutes='))?.split('=')[1] ?? 20);
  const deck = new PlayDeck({ start: performance.now(), minutes });
  const input = createInterface({ input: process.stdin, output: process.stdout });
  console.log('GUIDED QA session; not an uncoached enjoyment evaluation. No model or media starts.');
  console.log('Copy optional prompts manually into Fisch. n: next; completed/failed/skipped/uncertain: outcome.');
  console.log('rate 1..5 1..5: enjoyment/control; finish or abort: stop. Silence produces no prompts.');
  console.log('Only structured choices/timing/ratings go to .runtime/guided-play-session.json (overwritten).');
  const timer = setInterval(() => { save(deck); if (deck.finished) input.close(); }, 1000);
  input.on('SIGINT', () => { deck.finish(performance.now(), 'aborted'); input.close(); });
  try {
    save(deck);
    for await (const line of input) {
      try { action(deck, line.trim()); } catch { console.log('Choice unavailable or invalid.'); }
      save(deck); if (deck.finished) break;
    }
  } finally {
    clearInterval(timer); input.close();
    if (!deck.finished) deck.finish(performance.now(), 'aborted');
    save(deck); console.log(`Session saved: ${deck.reason}. Human acceptance remains pending.`);
  }
}
