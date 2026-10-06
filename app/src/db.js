// SQLite persistence for accounts and sessions, using Node's built-in driver.
// Schema changes are append-only migrations tracked with PRAGMA user_version.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MIGRATIONS = [
  // 1: accounts, with lockout state, and server-side sessions
  `CREATE TABLE users (
     id                    TEXT PRIMARY KEY,
     email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash         TEXT NOT NULL,
     first_name            TEXT NOT NULL,
     last_name             TEXT NOT NULL,
     created_at            TEXT NOT NULL,
     last_login_at         TEXT,
     failed_login_attempts INTEGER NOT NULL DEFAULT 0,
     locked_until          INTEGER
   );
   CREATE TABLE sessions (
     token_hash   TEXT PRIMARY KEY,
     user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at   INTEGER NOT NULL,
     last_seen_at INTEGER NOT NULL,
     expires_at   INTEGER NOT NULL
   );
   CREATE INDEX idx_sessions_user ON sessions(user_id);`,
];

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${version + 1} failed: ${err.message}`);
    }
  }
}
