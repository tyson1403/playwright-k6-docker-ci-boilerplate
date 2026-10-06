// Accounts, login lockout and server-side sessions, persisted in SQLite.
// The clock is injectable so time-based rules can be unit tested.
import crypto from 'node:crypto';

const MINUTE = 60_000;
// Expired sessions are kept this long before being purged, so a returning
// customer is told "your session expired" rather than "invalid session".
const PURGE_AFTER_MS = 24 * 60 * MINUTE;

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hashed] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 32), Buffer.from(hashed, 'hex'));
}

/** Only a hash of the session token is stored, so a leaked database can't be used to hijack sessions. */
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Verified against unknown emails so "no such user" takes as long as "wrong password".
const DUMMY_HASH = hashPassword('not-a-real-password');

const toUser = (row) =>
  row
    ? {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        passwordHash: row.password_hash,
        failedLoginAttempts: row.failed_login_attempts,
        lockedUntil: row.locked_until,
      }
    : null;

export function createAccounts(db, auth, clock = () => Date.now()) {
  const idleMs = auth.sessionIdleMinutes * MINUTE;
  const absoluteMs = auth.sessionAbsoluteHours * 60 * MINUTE;

  const sql = {
    insertUser: db.prepare(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    recordFailure: db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?'),
    lock: db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = ? WHERE id = ?'),
    recordSuccess: db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    sessionWithUser: db.prepare(
      `SELECT s.created_at AS s_created_at, s.last_seen_at, s.expires_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    ),
    touchSession: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?'),
    countUserSessions: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    countSessions: db.prepare('SELECT COUNT(*) AS n FROM sessions'),
  };

  const findByEmail = (email) => toUser(sql.userByEmail.get(String(email || '').trim()));

  function createUser({ email, password, firstName, lastName }) {
    const id = crypto.randomUUID();
    sql.insertUser.run(id, email.trim().toLowerCase(), hashPassword(password), firstName, lastName, new Date(clock()).toISOString());
    return findByEmail(email);
  }

  /**
   * Checks credentials and applies the lockout policy.
   * Returns { status: 'ok', user } | { status: 'invalid' } | { status: 'locked', lockedUntil }.
   */
  function authenticate(email, password) {
    const user = findByEmail(email);
    if (!user) {
      verifyPassword(String(password), DUMMY_HASH);
      return { status: 'invalid' }; // unknown emails are never locked: nothing to protect
    }
    const now = clock();
    if (user.lockedUntil && user.lockedUntil > now) return { status: 'locked', lockedUntil: user.lockedUntil };

    if (!verifyPassword(String(password), user.passwordHash)) {
      const attempts = user.failedLoginAttempts + 1;
      if (attempts >= auth.lockoutThreshold) {
        const lockedUntil = now + auth.lockoutMinutes * MINUTE;
        sql.lock.run(lockedUntil, user.id); // counter restarts once the lock expires
        return { status: 'locked', lockedUntil };
      }
      sql.recordFailure.run(attempts, user.id);
      return { status: 'invalid' };
    }

    sql.recordSuccess.run(new Date(now).toISOString(), user.id);
    return { status: 'ok', user: findByEmail(email) };
  }

  function createSession(userId) {
    const now = clock();
    sql.purgeSessions.run(now - PURGE_AFTER_MS, now - idleMs - PURGE_AFTER_MS);
    const token = crypto.randomBytes(32).toString('hex');
    sql.insertSession.run(hashToken(token), userId, now, now, now + absoluteMs);
    return { token, ...sessionTimes(now, now + absoluteMs) };
  }

  const sessionTimes = (lastSeenAt, expiresAt) => ({
    expiresAt: new Date(expiresAt).toISOString(),
    idleExpiresAt: new Date(Math.min(lastSeenAt + idleMs, expiresAt)).toISOString(),
    idleTimeoutSeconds: idleMs / 1000,
  });

  /**
   * Validates a token and slides the idle timeout forward.
   * Returns { status: 'ok', user, session } | { status: 'expired' } | { status: 'invalid' }.
   */
  function resolveSession(token) {
    const tokenHash = hashToken(String(token));
    const row = sql.sessionWithUser.get(tokenHash);
    if (!row) return { status: 'invalid' };
    const now = clock();
    if (now >= row.expires_at || now - row.last_seen_at >= idleMs) {
      sql.deleteSession.run(tokenHash);
      return { status: 'expired' };
    }
    sql.touchSession.run(now, tokenHash);
    return { status: 'ok', user: toUser(row), session: sessionTimes(now, row.expires_at) };
  }

  return {
    createUser,
    findByEmail,
    authenticate,
    createSession,
    resolveSession,
    deleteSession: (token) => sql.deleteSession.run(hashToken(String(token))).changes > 0,
    deleteSessionsForUser: (userId) => sql.deleteUserSessions.run(userId).changes,
    counts: () => ({ users: sql.countUsers.get().n, activeSessions: sql.countSessions.get().n }),

    reset(seedUsers = []) {
      db.exec('DELETE FROM sessions; DELETE FROM users;');
      seedUsers.forEach(createUser);
    },

    // ---- test support ----
    inspect(email) {
      const user = findByEmail(email);
      if (!user) return null;
      return {
        email: user.email,
        failedLoginAttempts: user.failedLoginAttempts,
        lockedUntil: user.lockedUntil ? new Date(user.lockedUntil).toISOString() : null,
        lastLoginAt: user.lastLoginAt,
        activeSessions: sql.countUserSessions.get(user.id).n,
      };
    },
    expireLock(email) {
      return db.prepare('UPDATE users SET locked_until = ? WHERE email = ?').run(clock() - 1, String(email)).changes > 0;
    },
    /** Moves a session back in time: `idleMinutes` since last activity, `ageMinutes` since login. */
    ageSession(token, { idleMinutes = 0, ageMinutes = 0 }) {
      return (
        db
          .prepare(
            `UPDATE sessions SET last_seen_at = last_seen_at - ?, created_at = created_at - ?, expires_at = expires_at - ?
             WHERE token_hash = ?`,
          )
          .run(idleMinutes * MINUTE, ageMinutes * MINUTE, ageMinutes * MINUTE, hashToken(String(token))).changes > 0
      );
    },
  };
}
