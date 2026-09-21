import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const isFresh = !fs.existsSync(DB_PATH);
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

if (isFresh) {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  const counts = db.transaction(() => seed(db))();
  console.log(
    `[db] created ${DB_PATH}\n` +
    `[db] seeded ${counts.donors} donors, ${counts.banks} blood banks, ${counts.hospitals} hospitals, ` +
    `${counts.requests} historic requests, ${counts.camps} camps, ${counts.accounts} accounts`
  );
} else {
  console.log(`[db] opened ${DB_PATH}`);
}

/** Batch statuses are time-dependent; roll expiry forward on every boot. */
export function sweepExpiry() {
  const r = db.prepare(
    `UPDATE stock_batches SET status='expired'
     WHERE status='available' AND expires_on < date('now')`
  ).run();
  if (r.changes) console.log(`[db] marked ${r.changes} batch(es) expired`);
}
sweepExpiry();
