import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures';
import { ROUTES, dubaiDate } from '../utils/test-data';

/** Fails on serious/critical WCAG 2.1 AA violations; minor issues are attached to the report. */
async function scan(page: import('@playwright/test').Page, testInfo: import('@playwright/test').TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  await testInfo.attach('axe-results', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual([]);
}

test.describe('Accessibility (axe, WCAG 2.1 AA)', () => {
  test('home / search page', async ({ home, page }, testInfo) => {
    await home.open();
    await scan(page, testInfo);
  });

  test('flight results page', async ({ page, results }, testInfo) => {
    await page.goto(`/flights?origin=DXB&destination=MCT&date=${dubaiDate(8)}&passengers=1`);
    await results.waitForResults();
    await scan(page, testInfo);
  });

  test('booking form, including error state', async ({ booking, api, page }, testInfo) => {
    const flight = await api.findFlight({ ...ROUTES.bookingUi, date: dubaiDate(8) });
    await booking.openFor(flight.id, 'STANDARD', 2);
    await booking.pay(); // trigger validation errors
    await expect(booking.alert).toBeVisible();
    await scan(page, testInfo);
  });

  test('check-in seat map', async ({ checkin, api, page }, testInfo) => {
    const created = await api.book({ route: ROUTES.checkinUi });
    await checkin.open();
    await checkin.start(created.pnr, created.passengers[0].lastName);
    await expect(checkin.seatmap).toBeVisible();
    await scan(page, testInfo);
  });

  test('form fields can be completed with the keyboard only', async ({ home, page }) => {
    await home.open();
    await page.keyboard.press('Tab'); // skip link
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await home.origin.focus();
    await page.keyboard.press('Tab');
    await expect(home.destination).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(home.date).toBeFocused();
  });
});
