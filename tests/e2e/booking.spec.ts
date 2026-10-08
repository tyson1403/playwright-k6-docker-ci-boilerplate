import { test, expect } from '../fixtures';
import { CARDS, PRICING, ROUTES, dubaiDate, party, passenger, uniqueEmail } from '../utils/test-data';
import type { Booking, Flight } from '../utils/skylane-api';

test.describe('Booking a flight', () => {
  test('guest books a family trip end-to-end from search to confirmation @smoke', async ({ home, results, booking, confirmation, api, page }) => {
    const passengers = party(2);
    const date = dubaiDate(4);
    const flight = await api.findFlight({ ...ROUTES.bookingUi, date, passengers: 2 });

    await test.step('search and pick a fare', async () => {
      await home.open();
      await home.search({ ...ROUTES.bookingUi, date, passengers: 2 });
      await results.selectFare(flight.id, 'STANDARD');
    });

    let expectedTotal: number;
    await test.step('check the price summary', async () => {
      await booking.waitForReady();
      await expect(booking.summaryFlight).toHaveText(flight.flightNumber);
      await expect(booking.summaryFare).toHaveText('Standard');
      const standard = flight.fares.find((f) => f.code === 'STANDARD')!.price;
      expectedTotal = 2 * (standard + PRICING.taxesPerPassenger + PRICING.extraBagPrice);
    });

    await test.step('enter passengers, add bags and pay', async () => {
      await booking.fillPassengers(passengers);
      await booking.fillContact(uniqueEmail('family'));
      await booking.extraBag.check();
      await expect(booking.priceTotal).toHaveText(`AED ${expectedTotal.toLocaleString('en-US')}`);
      await booking.fillPayment(CARDS.valid());
      await booking.pay();
    });

    await test.step('see the confirmation', async () => {
      await expect(page).toHaveURL(/\/confirmation\?pnr=[A-Z0-9]{6}/);
      await expect(confirmation.message).toContainText('Your booking is confirmed');
      await expect(confirmation.summary.status).toHaveText('Confirmed');
      await expect(confirmation.summary.flightNumber).toHaveText(flight.flightNumber);
      await expect(confirmation.summary.passengerNames).toHaveText(passengers.map((p) => `${p.title} ${p.firstName} ${p.lastName}`));
      await expect(confirmation.summary.total).toHaveText(`AED ${expectedTotal.toLocaleString('en-US')}`);
    });

    await test.step('the booking exists in the backend', async () => {
      const pnr = await confirmation.pnr();
      const saved = await api.json<Booking>(api.getBooking(pnr, passengers[0].lastName));
      expect(saved).toMatchObject({ status: 'CONFIRMED', fare: 'STANDARD', extraBag: true, price: { total: expectedTotal } });
    });
  });

  test('price summary updates when extra baggage is toggled', async ({ booking, api }) => {
    const flight = await api.findFlight({ ...ROUTES.bookingUi, date: dubaiDate(5), passengers: 3 });
    await booking.openFor(flight.id, 'SAVER', 3);

    await expect(booking.priceExtras).toHaveText('AED 0');
    await booking.extraBag.check();
    await expect(booking.priceExtras).toHaveText(`AED ${PRICING.extraBagPrice * 3}`);
    await booking.extraBag.uncheck();
    await expect(booking.priceExtras).toHaveText('AED 0');
  });

  test('highlights every missing required field', async ({ booking, api }) => {
    const flight = await api.findFlight({ ...ROUTES.bookingUi, date: dubaiDate(5) });
    await booking.openFor(flight.id, 'SAVER', 1);
    await booking.pay();

    await expect(booking.alert).toHaveText('Please complete the highlighted fields.');
    await expect(booking.fieldError('p0-title')).toHaveText('Please select a title');
    await expect(booking.fieldError('p0-first-name')).toHaveText('First name is required');
    await expect(booking.fieldError('contact-email')).toHaveText('Email is required');
    await expect(booking.fieldError('card-number')).toHaveText('Card number is required');
  });

  test('shows server-side validation next to the right field', async ({ booking, api }) => {
    const flight = await api.findFlight({ ...ROUTES.bookingUi, date: dubaiDate(5) });
    await booking.openFor(flight.id, 'SAVER', 1);
    await booking.completeBooking({
      passengers: [passenger({ firstName: 'R2D2' })],
      email: 'not-an-email',
      card: CARDS.invalidLuhn(),
    });

    await expect(booking.fieldError('p0-first-name')).toHaveText('First name must be 2-30 letters');
    await expect(booking.fieldError('contact-email')).toHaveText('A valid contact email is required');
    await expect(booking.fieldError('card-number')).toHaveText('Card number is invalid');
    await expect(booking.payButton).toBeEnabled();
  });

  test('a declined card keeps the customer on the page with an error @smoke', async ({ booking, api, page }) => {
    const flight = await api.findFlight({ ...ROUTES.bookingUi, date: dubaiDate(5) });
    await booking.openFor(flight.id, 'FLEX', 1);
    await booking.completeBooking({ passengers: [passenger()], email: uniqueEmail(), card: CARDS.declined() });

    await expect(booking.alert).toHaveText('Card declined by issuer');
    await expect(page).toHaveURL(/\/book\?/);
    await expect(booking.payButton).toBeEnabled();
  });

  test('a fixed card after a decline books successfully', async ({ booking, page, api }) => {
    const flight = await api.findFlight({ ...ROUTES.bookingUi, date: dubaiDate(5) });
    await booking.openFor(flight.id, 'SAVER', 1);
    await booking.completeBooking({ passengers: [passenger()], email: uniqueEmail(), card: CARDS.insufficientFunds() });
    await expect(booking.alert).toHaveText('Insufficient funds');

    await booking.fillPayment(CARDS.valid());
    await booking.pay();
    await expect(page).toHaveURL(/\/confirmation\?/);
  });

  test('double-clicking "Pay" creates only one booking', async ({ booking, page, api }) => {
    // Own flight and a known seat count, so other tests can't change the numbers.
    const flight = await api.flightWithSeats({ ...ROUTES.bookingUi, date: dubaiDate(31) }, 50);
    await booking.openFor(flight.id, 'SAVER', 1);
    await booking.fillPassengers([passenger()]);
    await booking.fillContact(uniqueEmail());
    await booking.fillPayment(CARDS.valid());

    // Bypass the disabled-button guard to simulate a really fast double click / retry.
    await booking.payButton.evaluate((btn: HTMLButtonElement) => {
      btn.click();
      btn.disabled = false;
      btn.click();
    });
    await expect(page).toHaveURL(/\/confirmation\?/);
    await expect.poll(async () => (await api.json<Flight>(api.flight(flight.id))).seatsAvailable).toBe(49);
  });

  test('logged-in customers have their details pre-filled', async ({ loggedInPage, booking, api }) => {
    const flight = await api.findFlight({ ...ROUTES.bookingUi, date: dubaiDate(5) });
    await loggedInPage.goto(`/book?flightId=${flight.id}&fare=SAVER&passengers=1`);
    await booking.waitForReady();

    await expect(booking.contactEmail).toHaveValue('demo@skylane.test');
    await expect(booking.passengerBlock(0).getByLabel('First name')).toHaveValue('Demo');
    await expect(booking.passengerBlock(0).getByLabel('Last name')).toHaveValue('Traveller');
  });

  test('opening the booking page without a flight shows guidance', async ({ page, booking }) => {
    await page.goto('/book');
    await expect(booking.alert).toHaveText('No flight selected. Please search for a flight first.');
  });
});
