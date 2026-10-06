import { test, expect } from '../fixtures';
import { DEMO_USER, ROUTES } from '../utils/test-data';
import { BookingSummary } from '../pages/confirmation.page';

test.describe('My trips', () => {
  test('lists bookings made while logged in', async ({ api, loggedInPage }) => {
    await api.loginAs(DEMO_USER.email, DEMO_USER.password);
    const created = await api.book({ route: ROUTES.trips, daysAhead: 15 });

    await loggedInPage.goto('/trips');
    const card = new BookingSummary(loggedInPage.getByTestId('booking-summary').filter({ hasText: created.pnr }));
    await expect(card.pnr).toHaveText(created.pnr);
    await expect(card.route).toHaveText('Dubai (DXB) → Jeddah (JED)');
    await expect(card.status).toHaveText('Confirmed');
  });

  test('an expired session sends the customer back to log in', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('skylane.session', JSON.stringify({ token: 'expired-token', user: { firstName: 'Ghost' } })),
    );
    await page.goto('/trips');
    await expect(page).toHaveURL('/login?next=/trips');
  });
});
