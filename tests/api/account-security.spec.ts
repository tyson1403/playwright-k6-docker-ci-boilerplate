// Account lockout and session timeout. Every test registers its own customer
// so lockouts never affect other tests; test hooks stand in for waiting 15 minutes.
import { test, expect } from '../fixtures';
import { CARDS, ROUTES, dubaiDate, passenger } from '../utils/test-data';
import type { AccountState, Customer, Session, SkyLaneApi } from '../utils/skylane-api';

interface Policy {
  lockoutThreshold: number;
  lockoutMinutes: number;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
}

let policy: Policy;

test.beforeAll(async ({ playwright }, testInfo) => {
  const request = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  policy = await (await request.get('/api/auth/policy')).json();
  await request.dispose();
});

const failLogins = async (api: SkyLaneApi, email: string, times: number) => {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await api.login(email, 'WrongPass1')).status());
  return statuses;
};

const state = (api: SkyLaneApi, email: string) => api.json<AccountState>(api.inspectUser(email));

test.describe('Account lockout', () => {
  let customer: Customer;

  test.beforeEach(async ({ api }) => {
    customer = await api.newCustomer('lockout');
  });

  test('policy is 5 attempts and a 15 minute lock by default', async () => {
    expect(policy).toMatchObject({ lockoutThreshold: 5, lockoutMinutes: 15 });
  });

  test('each failed login is counted against the account', async ({ api }) => {
    await failLogins(api, customer.email, 2);
    expect(await state(api, customer.email)).toMatchObject({ failedLoginAttempts: 2, lockedUntil: null });
  });

  test('the Nth consecutive failure locks the account with 423 and Retry-After @smoke', async ({ api }) => {
    const statuses = await failLogins(api, customer.email, policy.lockoutThreshold);
    expect(statuses).toEqual([...Array(policy.lockoutThreshold - 1).fill(401), 423]);

    const res = await api.login(customer.email, 'WrongPass1');
    expect(res.status()).toBe(423);
    const retryAfter = Number(res.headers()['retry-after']);
    expect(retryAfter).toBeGreaterThan(policy.lockoutMinutes * 60 - 10);
    expect(retryAfter).toBeLessThanOrEqual(policy.lockoutMinutes * 60);
    expect((await res.json()).error).toEqual({
      code: 'ACCOUNT_LOCKED',
      message: `Your account is temporarily locked after too many failed login attempts. Try again in ${policy.lockoutMinutes} minutes.`,
    });
  });

  test('a locked account rejects even the correct password and creates no session', async ({ api }) => {
    await failLogins(api, customer.email, policy.lockoutThreshold);
    const before = await state(api, customer.email);

    const res = await api.login(customer.email, customer.password);
    expect(res.status()).toBe(423);
    expect((await state(api, customer.email)).activeSessions).toBe(before.activeSessions);
  });

  test('the lock time is stored in the database', async ({ api }) => {
    const start = Date.now();
    await failLogins(api, customer.email, policy.lockoutThreshold);
    const { lockedUntil } = await state(api, customer.email);
    const lockMs = Date.parse(lockedUntil!) - start;
    expect(lockMs).toBeGreaterThan(policy.lockoutMinutes * 60_000 - 5_000);
    expect(lockMs).toBeLessThanOrEqual(policy.lockoutMinutes * 60_000 + 5_000);
  });

  test('a successful login before the limit resets the counter', async ({ api }) => {
    await failLogins(api, customer.email, policy.lockoutThreshold - 1);
    expect((await api.login(customer.email, customer.password)).status()).toBe(200);
    expect((await state(api, customer.email)).failedLoginAttempts).toBe(0);

    // A fresh allowance: another N-1 failures still don't lock.
    const statuses = await failLogins(api, customer.email, policy.lockoutThreshold - 1);
    expect(statuses.every((s) => s === 401)).toBe(true);
  });

  test('after the lock expires the customer can log in again', async ({ api }) => {
    await failLogins(api, customer.email, policy.lockoutThreshold);
    await api.json(api.expireLock(customer.email));

    const res = await api.login(customer.email, customer.password);
    expect(res.status()).toBe(200);
    expect(await state(api, customer.email)).toMatchObject({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: expect.any(String) });
  });

  test('after the lock expires the counter starts again rather than re-locking at once', async ({ api }) => {
    await failLogins(api, customer.email, policy.lockoutThreshold);
    await api.json(api.expireLock(customer.email));
    expect(await failLogins(api, customer.email, 1)).toEqual([401]);
    expect((await state(api, customer.email)).failedLoginAttempts).toBe(1);
  });

  test('email case variations count against the same account', async ({ api }) => {
    const variants = [customer.email.toUpperCase(), customer.email, ` ${customer.email} `];
    for (let i = 0; i < policy.lockoutThreshold; i++) await api.login(variants[i % variants.length], 'WrongPass1');
    expect((await api.login(customer.email, customer.password)).status()).toBe(423);
  });

  test('locking one account does not affect another', async ({ api }) => {
    const neighbour = await api.newCustomer('neighbour');
    await failLogins(api, customer.email, policy.lockoutThreshold);
    expect((await api.login(neighbour.email, neighbour.password)).status()).toBe(200);
  });

  test('unknown emails are never locked (nothing to protect, nothing to reveal)', async ({ api }) => {
    const statuses = await failLogins(api, 'nobody-here@example.com', policy.lockoutThreshold + 3);
    expect(new Set(statuses)).toEqual(new Set([401]));
  });

  test('a lockout does not end sessions that are already signed in', async ({ api }) => {
    await failLogins(api, customer.email, policy.lockoutThreshold);
    expect((await api.withToken(customer.token).me()).status()).toBe(200);
  });
});

test.describe('Session timeout', () => {
  let customer: Customer;

  test.beforeEach(async ({ api }) => {
    customer = await api.newCustomer('session');
  });

  test('login returns the session lifetime and idle timeout', async ({ api }) => {
    const before = Date.now();
    const session = await api.json<Session>(api.login(customer.email, customer.password));
    expect(session.idleTimeoutSeconds).toBe(policy.sessionIdleMinutes * 60);
    const lifetime = Date.parse(session.expiresAt) - before;
    expect(Math.abs(lifetime - policy.sessionAbsoluteHours * 3_600_000)).toBeLessThan(5_000);
    expect(Date.parse(session.idleExpiresAt) - before).toBeLessThanOrEqual(policy.sessionIdleMinutes * 60_000 + 5_000);
  });

  test('a session idle longer than the timeout is rejected with SESSION_EXPIRED @smoke', async ({ api }) => {
    await api.json(api.ageSession(customer.token, { idleMinutes: policy.sessionIdleMinutes + 1 }));
    const res = await api.withToken(customer.token).me();
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toEqual({ code: 'SESSION_EXPIRED', message: 'Your session has expired. Please log in again.' });
  });

  test('just inside the idle timeout the session still works', async ({ api }) => {
    await api.json(api.ageSession(customer.token, { idleMinutes: policy.sessionIdleMinutes - 1 }));
    expect((await api.withToken(customer.token).me()).status()).toBe(200);
  });

  test('activity slides the idle timeout forward', async ({ api }) => {
    const nearlyIdle = policy.sessionIdleMinutes - 2;
    await api.json(api.ageSession(customer.token, { idleMinutes: nearlyIdle }));
    expect((await api.withToken(customer.token).me()).status()).toBe(200); // activity
    await api.json(api.ageSession(customer.token, { idleMinutes: nearlyIdle }));
    // Total time since login is now well past the idle timeout, but never idle that long.
    expect((await api.withToken(customer.token).me()).status()).toBe(200);
  });

  test('the absolute lifetime ends a session even if it is in use', async ({ api }) => {
    await api.json(api.ageSession(customer.token, { ageMinutes: policy.sessionAbsoluteHours * 60 + 1 }));
    const res = await api.withToken(customer.token).me();
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe('SESSION_EXPIRED');
  });

  test('an expired session is deleted, not just refused', async ({ api }) => {
    await api.json(api.ageSession(customer.token, { idleMinutes: policy.sessionIdleMinutes + 1 }));
    await api.withToken(customer.token).me();
    expect((await state(api, customer.email)).activeSessions).toBe(0);
    expect((await (await api.me()).json()).error.code).toBe('UNAUTHORIZED');
  });

  test('an expired token is not silently accepted as a guest booking', async ({ api }) => {
    await api.json(api.ageSession(customer.token, { idleMinutes: policy.sessionIdleMinutes + 1 }));
    const flight = await api.findFlight({ ...ROUTES.booking, date: dubaiDate(9) });
    const res = await api.withToken(customer.token).createBooking({
      flightId: flight.id,
      fare: 'SAVER',
      passengers: [passenger()],
      contact: { email: customer.email },
      payment: CARDS.valid(),
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe('SESSION_EXPIRED');
  });

  test('each device has its own session; logging out one keeps the others', async ({ api }) => {
    const laptop = customer.token;
    const phone = (await api.json<Session>(api.login(customer.email, customer.password))).token;
    expect((await state(api, customer.email)).activeSessions).toBe(2);

    await api.withToken(laptop).logout();
    expect((await api.withToken(laptop).me()).status()).toBe(401);
    expect((await api.withToken(phone).me()).status()).toBe(200);
  });

  test('/me reports when the idle timeout will be reached', async ({ api }) => {
    const before = Date.now();
    const { session } = await api.json<{ session: Session }>(api.withToken(customer.token).me());
    const idleIn = Date.parse(session.idleExpiresAt) - before;
    expect(Math.abs(idleIn - policy.sessionIdleMinutes * 60_000)).toBeLessThan(5_000);
  });
});
