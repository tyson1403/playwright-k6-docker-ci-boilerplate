import { test, expect } from '../fixtures';
import { DEMO_USER, uniqueEmail } from '../utils/test-data';

test.describe('Customer account', () => {
  test('customer logs in and out @smoke', async ({ login, header, page }) => {
    await login.goto();
    await login.login(DEMO_USER.email, DEMO_USER.password);

    await expect(page).toHaveURL('/trips');
    await expect(header.greeting).toHaveText('Hi, Demo');

    await header.logout();
    await expect(header.loginLink).toBeVisible();
    await expect(header.greeting).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('skylane.session'))).toBeNull();
  });

  test('wrong password shows a generic error', async ({ login, page }) => {
    await login.goto();
    await login.login(DEMO_USER.email, 'WrongPass1');
    await expect(login.alert).toHaveText('Invalid email or password');
    await expect(page).toHaveURL('/login');
  });

  test('empty login form shows field errors without calling the API', async ({ login, page }) => {
    let apiCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/login')) apiCalled = true;
    });
    await login.goto();
    await login.submit.click();
    await expect(page.getByTestId('email-error')).toHaveText('Email is required');
    await expect(page.getByTestId('password-error')).toHaveText('Password is required');
    expect(apiCalled).toBe(false);
  });

  test('new customer registers and lands on an empty "My trips"', async ({ page, header }) => {
    await page.goto('/register');
    await page.getByLabel('First name').fill('Hamdan');
    await page.getByLabel('Last name').fill('Saeed');
    await page.getByLabel('Email').fill(uniqueEmail('signup'));
    await page.getByLabel('Password').fill('FlyHigh2026');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/trips');
    await expect(header.greeting).toHaveText('Hi, Hamdan');
    await expect(page.getByTestId('no-trips')).toBeVisible();
  });

  test('registration shows server validation per field', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('First name').fill('A');
    await page.getByLabel('Last name').fill('Saeed');
    await page.getByLabel('Email').fill(DEMO_USER.email);
    await page.getByLabel('Password').fill('weak');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByTestId('first-name-error')).toHaveText('First name must be 2-30 letters');
    await expect(page.getByTestId('password-error')).toContainText('at least 8 characters');
  });

  test('"My trips" redirects anonymous visitors to log in, then back', async ({ page, login }) => {
    await page.goto('/trips');
    await expect(page).toHaveURL('/login?next=/trips');
    await login.login(DEMO_USER.email, DEMO_USER.password);
    await expect(page).toHaveURL('/trips');
  });

  test('login ignores off-site "next" redirects', async ({ page, login }) => {
    await page.goto('/login?next=//evil.example.com');
    await login.login(DEMO_USER.email, DEMO_USER.password);
    await expect(page).toHaveURL('/trips');
  });
});
