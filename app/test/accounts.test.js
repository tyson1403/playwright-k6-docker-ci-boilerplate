// Integration tests: accounts service against a real SQLite file, with a fake clock.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MIGRATIONS, openDatabase } from '../src/db.js';
import { createAccounts, hashToken } from '../src/services/accounts.js';

const POLICY = { lockoutThreshold: 3, lockoutMinutes: 15, sessionIdleMinutes: 15, sessionAbsoluteHours: 8 };
const MINUTE = 60_000;
const USER = { email: 'Aisha@Example.com', password: 'Secur3Pass', firstName: 'Aisha', lastName: 'Rahman' };

let dir, file, db, now, accounts;
const clock = () => now;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skylane-'));
  file = path.join(dir, 'test.db');
  db = openDatabase(file);
  now = Date.parse('2026-10-06T08:00:00Z');
  accounts = createAccounts(db, POLICY, clock);
  accounts.createUser(USER);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const fail = () => accounts.authenticate(USER.email, 'WrongPass1');

test('accounts survive closing and reopening the database', () => {
  db.close();
  db = openDatabase(file);
  accounts = createAccounts(db, POLICY, clock);
  assert.equal(accounts.authenticate(USER.email, USER.password).status, 'ok');
});

test('migrations run once and record the schema version', () => {
  db.close();
  db = openDatabase(file); // reopening must not re-run migrations
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
});

test('emails are stored lower-case and unique regardless of case', () => {
  assert.equal(accounts.findByEmail('aisha@example.com').email, 'aisha@example.com');
  assert.throws(() => accounts.createUser({ ...USER, email: 'AISHA@example.COM' }), /UNIQUE/);
});

test('passwords are stored as salted scrypt hashes, never in plain text', () => {
  const row = db.prepare('SELECT password_hash FROM users').get();
  assert.doesNotMatch(row.password_hash, /Secur3Pass/);
  assert.match(row.password_hash, /^[a-f0-9]{32}:[a-f0-9]{64}$/);
  accounts.createUser({ ...USER, email: 'twin@example.com' });
  const [a, b] = db.prepare('SELECT password_hash FROM users').all();
  assert.notEqual(a.password_hash, b.password_hash); // same password, different salt
});

test('session tokens are stored only as SHA-256 hashes', () => {
  const { token } = accounts.createSession(accounts.findByEmail(USER.email).id);
  const stored = db.prepare('SELECT token_hash FROM sessions').get().token_hash;
  assert.notEqual(stored, token);
  assert.equal(stored, hashToken(token));
});

test('locks the account on the Nth consecutive failure, even for the right password', () => {
  assert.equal(fail().status, 'invalid');
  assert.equal(fail().status, 'invalid');
  const locked = fail();
  assert.equal(locked.status, 'locked');
  assert.equal(locked.lockedUntil, now + 15 * MINUTE);
  assert.equal(accounts.authenticate(USER.email, USER.password).status, 'locked');
});

test('a successful login resets the failure counter', () => {
  fail();
  fail();
  assert.equal(accounts.authenticate(USER.email, USER.password).status, 'ok');
  fail();
  fail();
  assert.equal(accounts.inspect(USER.email).failedLoginAttempts, 2);
  assert.equal(accounts.inspect(USER.email).lockedUntil, null);
});

test('the lock lifts after the lockout period and the counter starts again', () => {
  fail();
  fail();
  fail();
  now += 15 * MINUTE - 1;
  assert.equal(accounts.authenticate(USER.email, USER.password).status, 'locked');
  now += 1;
  assert.equal(fail().status, 'invalid'); // a fresh set of attempts, not an instant re-lock
  assert.equal(accounts.authenticate(USER.email, USER.password).status, 'ok');
});

test('unknown emails are never locked', () => {
  for (let i = 0; i < 10; i++) assert.equal(accounts.authenticate('ghost@example.com', 'x').status, 'invalid');
});

test('sessions expire after the idle timeout, sliding with activity', () => {
  const { token } = accounts.createSession(accounts.findByEmail(USER.email).id);
  now += 14 * MINUTE;
  assert.equal(accounts.resolveSession(token).status, 'ok'); // activity slides the window
  now += 14 * MINUTE;
  assert.equal(accounts.resolveSession(token).status, 'ok');
  now += 15 * MINUTE;
  assert.equal(accounts.resolveSession(token).status, 'expired');
  assert.equal(accounts.resolveSession(token).status, 'invalid'); // and it was deleted
});

test('sessions end at the absolute lifetime even when active', () => {
  const { token, expiresAt } = accounts.createSession(accounts.findByEmail(USER.email).id);
  assert.equal(expiresAt, new Date(now + 8 * 60 * MINUTE).toISOString());
  for (let i = 0; i < 8 * 6 - 1; i++) {
    now += 10 * MINUTE;
    assert.equal(accounts.resolveSession(token).status, 'ok');
  }
  now += 10 * MINUTE;
  assert.equal(accounts.resolveSession(token).status, 'expired');
});

test('logging out one session leaves the user\'s other sessions working', () => {
  const userId = accounts.findByEmail(USER.email).id;
  const laptop = accounts.createSession(userId).token;
  const phone = accounts.createSession(userId).token;
  assert.equal(accounts.deleteSession(laptop), true);
  assert.equal(accounts.resolveSession(laptop).status, 'invalid');
  assert.equal(accounts.resolveSession(phone).status, 'ok');
});

test('expired sessions are purged a day after they expire, on the next login', () => {
  const userId = accounts.findByEmail(USER.email).id;
  const { token } = accounts.createSession(userId);
  now += 16 * MINUTE;
  accounts.createSession(userId);
  assert.equal(accounts.counts().activeSessions, 2); // still reported as SESSION_EXPIRED for now
  assert.equal(accounts.resolveSession(token).status, 'expired');

  const { token: stale } = accounts.createSession(userId);
  now += 24 * 60 * MINUTE + 16 * MINUTE;
  accounts.createSession(userId);
  assert.equal(accounts.counts().activeSessions, 1);
  assert.equal(accounts.resolveSession(stale).status, 'invalid');
});

test('reset removes everyone except the seeded users', () => {
  accounts.reset([{ ...USER, email: 'seed@example.com' }]);
  assert.equal(accounts.findByEmail(USER.email), null);
  assert.ok(accounts.findByEmail('seed@example.com'));
  assert.deepEqual(accounts.counts(), { users: 1, activeSessions: 0 });
});
