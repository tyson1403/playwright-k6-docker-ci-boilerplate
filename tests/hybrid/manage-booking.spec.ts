// Hybrid tests: create data quickly through the API, then verify behaviour in the UI.
import { test, expect } from '../fixtures';
import { PRICING, ROUTES, party } from '../utils/test-data';
import type { Booking } from '../utils/skylane-api';

test.describe('Manage booking', () => {
  test('retrieves a booking by PNR and last name @smoke', async ({ api, manage }) => {
    const created = await api.book({ route: ROUTES.manage, passengers: party(2), fare: 'FLEX' });

    await manage.open();
    await manage.retrieve(created.pnr.toLowerCase(), created.passengers[1].lastName.toUpperCase());

    await expect(manage.summary.pnr).toHaveText(created.pnr);
    await expect(manage.summary.status).toHaveText('Confirmed');
    await expect(manage.summary.fare).toHaveText('Flex');
    await expect(manage.summary.passengerNames).toHaveCount(2);
  });

  test('wrong last name shows a friendly not-found message', async ({ api, manage }) => {
    const created = await api.book({ route: ROUTES.manage });
    await manage.open();
    await manage.retrieve(created.pnr, 'Nobody');
    await expect(manage.alert).toHaveText('We could not find a booking with those details. Please check and try again.');
    await expect(manage.summary.pnr).toBeHidden();
  });

  test('validates the booking reference format before calling the API', async ({ manage, page }) => {
    await manage.open();
    await manage.retrieve('AB1', '');
    await expect(page.getByTestId('pnr-error')).toHaveText('Booking reference must be 6 letters or numbers');
    await expect(page.getByTestId('last-name-error')).toHaveText('Last name is required');
  });

  test('customer cancels a Standard booking and sees the refund @smoke', async ({ api, manage }) => {
    const created = await api.book({ route: ROUTES.manage, fare: 'STANDARD', passengers: party(2) });
    const expectedRefund = created.price.total - PRICING.standardCancelFee * 2;

    await manage.open();
    await manage.retrieve(created.pnr, created.passengers[0].lastName);
    await manage.cancelButton.click();
    await expect(manage.cancelDialog).toBeVisible();
    await expect(manage.cancelDialog).toContainText('refunded less a cancellation fee');
    await manage.confirmCancel.click();

    await expect(manage.cancelDialog).toBeHidden();
    await expect(manage.summary.status).toHaveText('Cancelled');
    await expect(manage.summary.refund).toHaveText(`Refund: AED ${expectedRefund.toLocaleString('en-US')}`);
    await expect(manage.alert).toContainText('Your booking has been cancelled');
    await expect(manage.cancelButton).toBeHidden();

    const saved = await api.json<Booking>(api.getBooking(created.pnr, created.passengers[0].lastName));
    expect(saved.status).toBe('CANCELLED');
  });

  test('"Keep booking" closes the dialog without cancelling', async ({ api, manage }) => {
    const created = await api.book({ route: ROUTES.manage, fare: 'SAVER' });
    await manage.open();
    await manage.retrieve(created.pnr, created.passengers[0].lastName);
    await manage.cancelButton.click();
    await expect(manage.cancelDialog).toContainText('only airport taxes will be refunded');
    await manage.dismissCancel.click();

    await expect(manage.cancelDialog).toBeHidden();
    await expect(manage.summary.status).toHaveText('Confirmed');
    const saved = await api.json<Booking>(api.getBooking(created.pnr, created.passengers[0].lastName));
    expect(saved.status).toBe('CONFIRMED');
  });

  test('a booking cancelled elsewhere shows as cancelled with no actions', async ({ api, manage, page }) => {
    const created = await api.book({ route: ROUTES.manage });
    await api.json(api.cancelBooking(created.pnr, created.passengers[0].lastName));

    await page.goto(`/manage?pnr=${created.pnr}&lastName=${created.passengers[0].lastName}`);
    await expect(manage.summary.status).toHaveText('Cancelled');
    await expect(manage.cancelButton).toBeHidden();
    await expect(manage.checkinLink).toBeHidden();
  });

  test('a booking departing tomorrow offers "Check in now"', async ({ api, manage, page }) => {
    const created = await api.book({ route: ROUTES.manage, daysAhead: 1 });
    await page.goto(`/manage?pnr=${created.pnr}&lastName=${created.passengers[0].lastName}`);
    await manage.checkinLink.click();
    await expect(page).toHaveURL(/\/checkin\?pnr=/);
  });
});
