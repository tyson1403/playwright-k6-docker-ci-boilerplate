// Lockout and session-timeout behaviour in the browser.
// page.clock fast-forwards the browser's timers, so "15 minutes idle" takes milliseconds.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import type { Customer, SkyLaneApi } from '../utils/skylane-api';

const LOCKED_MESSAGE = /Your account is temporarily locked after too many failed login attempts\. Try again in \d+ minutes\./;
const IDLE_MESSAGE = 'For your security, you were signed out after a period of inactivity. Please log in again.';
const EXPIRED_MESSAGE = 'Your session has expired. Please log in again.';

let policy: { lockoutThreshold: number; sessionIdleMinutes: number };

test.beforeAll(async ({ playwright }, testInfo) => {
  const request = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  policy = await (await request.get('/api/auth/policy')).json();
  await request.dispose();
});

const minutes = (m: number, s = 0) => `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
const sessionToken = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('skylane.session') ?? 'null')?.token as string);

async function lockAccount(api: SkyLaneApi, customer: Customer) {
  for (let i = 0; i < policy.lockoutThreshold; i++) await api.login(customer.email, 'WrongPass1');
}

test.describe('Account lockout (UI)', () => {
  test('repeated wrong passwords lock the account @smoke', async ({ api, login }) => {
    const customer = await api.newCustomer('ui-lock');
    await login.goto();

    for (let i = 1; i < policy.lockoutThreshold; i++) {
      await login.login(customer.email, `WrongPass${i}`);
      await expect(login.alert).toHaveText('Invalid email or password');
    }
    await login.login(customer.email, 'WrongPassLast1');
    await expect(login.alert).toHaveText(LOCKED_MESSAGE);
  });

  test('a locked account cannot log in, even with the right password', async ({ api, login, page }) => {
    const customer = await api.newCustomer('ui-locked');
    await lockAccount(api, customer);

    await login.goto();
    await login.login(customer.email, customer.password);
    await expect(login.alert).toHaveText(LOCKED_MESSAGE);
    await expect(page).toHaveURL('/login');
    expect(await sessionToken(page)).toBeUndefined();
  });

  test('once the lock expires the customer can log in', async ({ api, login, page, header }) => {
    const customer = await api.newCustomer('ui-unlock');
    await lockAccount(api, customer);
    await api.json(api.expireLock(customer.email));

    await login.goto();
    await login.login(customer.email, customer.password);
    await expect(page).toHaveURL('/trips');
    await expect(header.greeting).toHaveText(`Hi, ${customer.firstName}`);
  });
});

test.describe('Session timeout (UI)', () => {
  let customer: Customer;

  /** Logs in through the UI with the browser clock under test control. */
  test.beforeEach(async ({ api, login, page }) => {
    customer = await api.newCustomer('ui-session');
    await page.clock.install();
    await login.goto();
    await login.login(customer.email, customer.password);
    await expect(page).toHaveURL('/trips');
    // The idle timer starts once the page has confirmed the session with the server.
    await expect(page.locator('body')).toHaveAttribute('data-session-watch', 'active');
  });

  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Are you still there?' });

  test('warns one minute before the idle timeout @smoke', async ({ page }) => {
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes - 2));
    await expect(dialog(page)).toBeHidden();

    await page.clock.fastForward(minutes(1, 5));
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('session-countdown')).toHaveText(/^[1-5]\d$/);
    await expect(page.getByRole('button', { name: 'Stay signed in' })).toBeVisible();
  });

  test('"Stay signed in" keeps the customer logged in and restarts the timer', async ({ page, api, header }) => {
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes - 1, 5));
    const keepAlive = page.waitForResponse((r) => r.url().endsWith('/api/auth/me') && r.status() === 200);
    await page.getByRole('button', { name: 'Stay signed in' }).click();
    await keepAlive;
    await expect(dialog(page)).toBeHidden();

    // A full idle period later than the original deadline: still signed in, warned again.
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes - 1, 5));
    await expect(dialog(page)).toBeVisible();
    await expect(page).toHaveURL('/trips');
    await expect(header.greeting).toBeVisible();
    expect((await api.withToken(await sessionToken(page)).me()).status()).toBe(200);
  });

  test('Escape does not dismiss the warning', async ({ page }) => {
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes - 1, 5));
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
  });

  test('signs the customer out after the idle timeout and ends the server session', async ({ page, api, login, header }) => {
    const token = await sessionToken(page);
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes, 1));

    await expect(page).toHaveURL('/login?reason=idle&next=%2Ftrips');
    await expect(login.alert).toHaveText(IDLE_MESSAGE);
    await expect(header.loginLink).toBeVisible();
    expect(await sessionToken(page)).toBeUndefined();
    expect((await api.withToken(token).me()).status()).toBe(401); // logged out on the server too
  });

  test('logging in again after an idle sign-out returns to the same page', async ({ page, login }) => {
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes, 1));
    await expect(page).toHaveURL(/reason=idle/);
    await login.login(customer.email, customer.password);
    await expect(page).toHaveURL('/trips');
  });

  test('"Log out now" in the warning signs out immediately', async ({ page, header }) => {
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes - 1, 5));
    await page.getByRole('button', { name: 'Log out now' }).click();
    await expect(page).toHaveURL('/');
    await expect(header.loginLink).toBeVisible();
  });

  test('activity resets the idle timer', async ({ page }) => {
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes - 3));
    await page.getByRole('heading', { name: 'My trips' }).click(); // any interaction counts
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes - 3));
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL('/trips');
  });

  test('a session that expired on the server sends the customer to log in, then back', async ({ page, api, login }) => {
    await api.json(api.ageSession(await sessionToken(page), { idleMinutes: policy.sessionIdleMinutes + 1 }));
    await page.reload();

    await expect(page).toHaveURL('/login?reason=expired&next=%2Ftrips');
    await expect(login.alert).toHaveText(EXPIRED_MESSAGE);
    await login.login(customer.email, customer.password);
    await expect(page).toHaveURL('/trips');
  });

  test('on a public page an expired session just shows a notice', async ({ page, api, header }) => {
    await api.json(api.ageSession(await sessionToken(page), { idleMinutes: policy.sessionIdleMinutes + 1 }));
    await page.goto('/');

    await expect(page.getByTestId('session-notice')).toContainText(EXPIRED_MESSAGE);
    await expect(page).toHaveURL('/');
    await expect(header.loginLink).toBeVisible();
  });

  test('the timeout warning is accessible', async ({ page }, testInfo) => {
    await page.clock.fastForward(minutes(policy.sessionIdleMinutes - 1, 5));
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stay signed in' })).toBeFocused();

    const results = await new AxeBuilder({ page }).include('#session-dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
    await testInfo.attach('axe-results', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});
