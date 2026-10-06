import { test, expect } from '../fixtures';
import { DEMO_USER, uniqueEmail } from '../utils/test-data';

test.describe('Auth API', () => {
  test('demo user can log in and receives a bearer token @smoke', async ({ api }) => {
    const res = await api.login(DEMO_USER.email, DEMO_USER.password);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[a-f0-9]{48}$/);
    expect(body.user).toEqual({ id: expect.any(String), email: DEMO_USER.email, firstName: 'Demo', lastName: 'Traveller' });
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  test('login is case-insensitive on email', async ({ api }) => {
    expect((await api.login(DEMO_USER.email.toUpperCase(), DEMO_USER.password)).status()).toBe(200);
  });

  test('wrong password and unknown email give the same 401 (no account enumeration)', async ({ api }) => {
    const wrongPassword = await api.login(DEMO_USER.email, 'WrongPass1');
    const unknownUser = await api.login('nobody@example.com', 'WrongPass1');
    expect(wrongPassword.status()).toBe(401);
    expect(unknownUser.status()).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownUser.json());
  });

  test('missing credentials return 400', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { email: DEMO_USER.email } });
    expect(res.status()).toBe(400);
  });

  test('malformed JSON body returns 400 INVALID_JSON', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: '{"email": ', headers: { 'Content-Type': 'application/json' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_JSON');
  });

  test('register creates an account that can log in', async ({ api }) => {
    const email = uniqueEmail('register');
    const res = await api.register({ email, password: 'Secur3Pass', firstName: 'Aisha', lastName: 'Rahman' });
    expect(res.status()).toBe(201);
    expect((await res.json()).user).toMatchObject({ email, firstName: 'Aisha' });
    expect((await api.login(email, 'Secur3Pass')).status()).toBe(200);
  });

  test('registering an existing email returns 409 EMAIL_TAKEN', async ({ api }) => {
    const res = await api.register({ email: DEMO_USER.email, password: 'Secur3Pass', firstName: 'Copy', lastName: 'Cat' });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe('EMAIL_TAKEN');
  });

  for (const password of ['short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere']) {
    test(`weak password "${password}" is rejected`, async ({ api }) => {
      const res = await api.register({ email: uniqueEmail(), password, firstName: 'Weak', lastName: 'Password' });
      expect(res.status()).toBe(400);
      expect((await res.json()).error.details).toContainEqual(expect.objectContaining({ field: 'password' }));
    });
  }

  test('/me requires a valid token', async ({ api }) => {
    expect((await api.me()).status()).toBe(401);
    expect((await api.withToken('not-a-real-token').me()).status()).toBe(401);
  });

  test('logout invalidates the token', async ({ api }) => {
    await api.loginAs(DEMO_USER.email, DEMO_USER.password);
    expect((await api.me()).status()).toBe(200);
    expect((await api.logout()).status()).toBe(204);
    expect((await api.me()).status()).toBe(401);
  });
});
