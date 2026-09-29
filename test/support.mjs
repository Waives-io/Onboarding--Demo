import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Minimal D1 over node:sqlite with the migrations applied. batch() runs in one transaction, like D1.
// db.onPrepare(sql) lets a test inject a competing write at an exact point in a request.
export function d1() {
  const raw = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) raw.exec(readFileSync(new URL(f, dir), 'utf8'));
  const prepare = sql => {
    db.onPrepare?.(sql);
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      async first() { return raw.prepare(sql).get(...args) ?? null; },
      async all() { return { results: raw.prepare(sql).all(...args) }; },
      async run() { return s.exec(); },
      exec() { const r = raw.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    };
    return s;
  };
  const db = {
    raw, prepare,
    async batch(list) {
      raw.exec('BEGIN');
      try { const out = list.map(s => s.exec()); raw.exec('COMMIT'); return out; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  return db;
}

