import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planBody } from './expression-plan.mjs';

export function geometryKey(body) {
  const parts = (body?.children ?? []).flatMap(beat => beat.children ?? []).filter(node => node.type === 'assemble')
    .map(node => node.parts.map(({ kind, points, center, scale, rotation }) => ({ kind, points, center, scale, rotation }))
      .map(part => JSON.stringify(part, (_, value) => typeof value === 'number' ? Math.round(value * 20) / 20 : value)).sort());
  return parts.length ? createHash('sha256').update(JSON.stringify(parts)).digest('hex') : null;
}
export class Repertoire {
  entries = []; cursor = 0; error = null;
  constructor(file) {
    this.file = file instanceof URL ? fileURLToPath(file) : file;
    if (!this.file) return;
    try {
      if (statSync(this.file).size > 262144) throw Error();
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      if (data.v !== 1 || !Array.isArray(data.plans) || data.plans.length > 8) throw Error();
      for (const item of data.plans) this.remember(planBody(item), item.concept, false);
    } catch (error) { if (error.code !== 'ENOENT') this.error = 'repertoire_cache_invalid'; }
  }
  remember(body, concept, save = true) {
    const key = geometryKey(body);
    if (!key || Buffer.byteLength(JSON.stringify(body)) > 32768) return false;
    if (this.entries.some(item => item.key === key)) return false;
    const label = typeof concept === 'string' ? concept.replace(/[\x00-\x1f]/g, '').slice(0, 80) : '';
    this.entries.unshift({ key, body: structuredClone(body), concept: label });
    this.entries.length = Math.min(8, this.entries.length);
    if (save) this.save(); return true;
  }
  pick(current) {
    if (!this.entries.length) return null;
    for (let i = 0; i < this.entries.length; i++) {
      const item = this.entries[this.cursor++ % this.entries.length];
      if (item.key !== current || this.entries.length === 1) return item;
    }
    return this.entries[0];
  }
  save() {
    if (!this.file) return;
    let temporary;
    try {
      const directory = dirname(this.file); mkdirSync(directory, { recursive: true });
      let data = JSON.stringify({ v: 1, plans: this.entries.map(({ body, concept }) => ({ body, concept })) });
      while (Buffer.byteLength(data) > 262144 && this.entries.length > 1) {
        this.entries.pop(); data = JSON.stringify({ v: 1, plans: this.entries.map(({ body, concept }) => ({ body, concept })) });
      }
      temporary = join(directory, `repertoire-${randomUUID()}.tmp`);
      writeFileSync(temporary, data, { mode: 0o600 }); renameSync(temporary, this.file); this.error = null;
    } catch { this.error = 'repertoire_cache_write_failed'; }
    finally { if (temporary) { try { rmSync(temporary, { force: true }); } catch {} } }
  }
  get recent() { return this.entries.slice(0, 5).map(item => item.concept ||
    item.body.children.flatMap(beat => beat.children).filter(node => node.type === 'assemble').flatMap(node => node.parts.map(p => p.id)).join(', ').slice(0, 160)); }
  get info() { return { size: this.entries.length, cache: !!this.file, cacheError: this.error, recentConcepts: this.recent }; }
}
