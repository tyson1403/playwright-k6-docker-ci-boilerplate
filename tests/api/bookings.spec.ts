import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures';
import { CARDS, DEMO_USER, PRICING, ROUTES, dubaiDate, party, passenger, type FareCode } from '../utils/test-data';
import type { Booking, BookingRequest, Flight, SkyLaneApi } from '../utils/skylane-api';

test.describe('Bookings API', () => {
  let flight: Flight;

  test.beforeEach(async ({ api }) => {
    // Shared flight for tests that don't count seats; topped up so parallel bookings never sell it out.
    flight = await api.findFlight({ ...ROUTES.booking, date: dubaiDate(3) });
    await api.json(api.setInventory(flight.id, 180));
  });

  /** A flight no other test touches, for tests that assert exact seat counts. */
  const dedicatedFlight = (api: SkyLaneApi, daysAhead: number) =>
    api.flightWithSeats({ ...ROUTES.booking, date: dubaiDate(daysAhead) }, 100);

  const bookingRequest = (overrides: Partial<BookingRequest> = {}): BookingRequest => ({
    flightId: flight.id,
    fare: 'STANDARD',
    passengers: [passenger()],
    contact: { email: 'traveller@example.com' },
    extraBag: false,
    payment: CARDS.valid(),
    ...overrides,
  });

  test('creates a confirmed booking with a 6-character PNR @smoke', async ({ api }) => {
    const res = await api.createBooking(bookingRequest());
    expect(res.status()).toBe(201);
    const booking: Booking = await res.json();

    expect(booking.pnr).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(res.headers()['location']).toBe(`/api/bookings/${booking.pnr}`);
    expect(booking).toMatchObject({ status: 'CONFIRMED', fare: 'STANDARD', flight: { id: flight.id } });
    expect(booking.passengers[0]).toMatchObject({ id: 'P1', seat: null, checkedIn: false });
  });

  test('never returns or stores the full card number', async ({ api }) => {
    const booking = await api.json<Booking>(api.createBooking(bookingRequest()), 201);
    expect(booking.payment).toEqual({ cardLast4: '1111', authCode: expect.stringMatching(/^[A-Z0-9]+$/) });
    expect(JSON.stringify(booking)).not.toContain('4111111111111111');
  });

  test('price charged matches the quote for a family booking with extra bags', async ({ api }) => {
    const passengers = party(4);
    const quote = await api.json<Booking['price']>(api.quote(flight.id, { fare: 'FLEX', passengers: 4, extraBag: true }));
    const booking = await api.json<Booking>(api.createBooking(bookingRequest({ fare: 'FLEX', passengers, extraBag: true })), 201);

    const flexFare = flight.fares.find((f) => f.code === 'FLEX')!.price;
    expect(quote).toMatchObject(booking.price);
    expect(booking.price.total).toBe(4 * (flexFare + PRICING.taxesPerPassenger + PRICING.extraBagPrice));
  });

  test('booking reduces seat availability by the party size', async ({ api }) => {
    const own = await dedicatedFlight(api, 40);
    await api.json(api.createBooking(bookingRequest({ flightId: own.id, passengers: party(3) })), 201);
    expect((await api.json<Flight>(api.flight(own.id))).seatsAvailable).toBe(97);
  });

  test('booking can be retrieved by PNR and any passenger last name, case-insensitively', async ({ api }) => {
    const passengers = [passenger(), passenger({ title: 'MS', firstName: 'Fatima' })];
    const booking = await api.json<Booking>(api.createBooking(bookingRequest({ passengers })), 201);

    for (const lastName of [passengers[0].lastName, passengers[1].lastName.toUpperCase(), ` ${passengers[1].lastName.toLowerCase()} `]) {
      const res = await api.getBooking(booking.pnr.toLowerCase(), lastName);
      expect(res.status(), lastName).toBe(200);
      expect((await res.json()).pnr).toBe(booking.pnr);
    }
  });

  test('wrong last name or unknown PNR both return 404 (no PNR enumeration)', async ({ api }) => {
    const booking = await api.json<Booking>(api.createBooking(bookingRequest()), 201);
    const wrongName = await api.getBooking(booking.pnr, 'Somebody');
    const unknownPnr = await api.getBooking('ZZZZZZ', 'Somebody');
    const noName = await api.getBooking(booking.pnr);
    for (const res of [wrongName, unknownPnr, noName]) expect(res.status()).toBe(404);
    expect(await wrongName.json()).toEqual(await unknownPnr.json());
  });

  test('Idempotency-Key replays the original booking instead of charging twice', async ({ api }) => {
    const key = randomUUID();
    const own = await dedicatedFlight(api, 41);
    const request = bookingRequest({ flightId: own.id });

    const first = await api.createBooking(request, key);
    const retry = await api.createBooking(request, key);

    expect(first.status()).toBe(201);
    expect(retry.status()).toBe(200);
    expect(retry.headers()['idempotent-replay']).toBe('true');
    expect((await retry.json()).pnr).toBe((await first.json()).pnr);
    expect((await api.json<Flight>(api.flight(own.id))).seatsAvailable).toBe(99);
  });

  test.describe('payment', () => {
    for (const [name, card, message, daysAhead] of [
      ['declined card', CARDS.declined(), 'Card declined by issuer', 42],
      ['insufficient funds', CARDS.insufficientFunds(), 'Insufficient funds', 43],
    ] as const) {
      test(`${name} returns 402 and releases the held seats`, async ({ api }) => {
        const own = await dedicatedFlight(api, daysAhead);
        const res = await api.createBooking(bookingRequest({ flightId: own.id, payment: card, passengers: party(2) }));
        expect(res.status()).toBe(402);
        expect((await res.json()).error).toMatchObject({ code: 'PAYMENT_DECLINED', message });
        expect((await api.json<Flight>(api.flight(own.id))).seatsAvailable).toBe(100);
      });
    }

    for (const [name, card, field] of [
      ['card failing the Luhn check', CARDS.invalidLuhn(), 'payment.number'],
      ['expired card', CARDS.expired(), 'payment.expiry'],
      ['short CVV', { ...CARDS.valid(), cvv: '12' }, 'payment.cvv'],
      ['missing card holder', { ...CARDS.valid(), holder: ' ' }, 'payment.holder'],
    ] as const) {
      test(`rejects ${name} with a field error`, async ({ api }) => {
        const res = await api.createBooking(bookingRequest({ payment: card }));
        expect(res.status()).toBe(400);
        expect((await res.json()).error.details).toContainEqual(expect.objectContaining({ field }));
      });
    }
  });

  test.describe('validation', () => {
    const cases: Array<[string, (r: BookingRequest) => Record<string, unknown>, string]> = [
      ['no passengers', (r) => ({ ...r, passengers: [] }), 'passengers'],
      ['ten passengers', (r) => ({ ...r, passengers: party(9).concat(passenger()) }), 'passengers'],
      ['name with digits', (r) => ({ ...r, passengers: [passenger({ firstName: 'J0hn' })] }), 'passengers[0].firstName'],
      ['one-letter last name', (r) => ({ ...r, passengers: [passenger({ lastName: 'X' })] }), 'passengers[0].lastName'],
      ['invalid title', (r) => ({ ...r, passengers: [{ ...passenger(), title: 'DR' }] }), 'passengers[0].title'],
      ['invalid email', (r) => ({ ...r, contact: { email: 'not-an-email' } }), 'contact.email'],
      ['unknown fare', (r) => ({ ...r, fare: 'FIRST' }), 'fare'],
      ['non-boolean extraBag', (r) => ({ ...r, extraBag: 'yes' }), 'extraBag'],
    ];

    for (const [name, mutate, field] of cases) {
      test(`rejects ${name}`, async ({ api }) => {
        const res = await api.createBooking(mutate(bookingRequest()));
        expect(res.status()).toBe(400);
        const { error } = await res.json();
        expect(error.code).toBe('VALIDATION_ERROR');
        expect(error.details).toContainEqual(expect.objectContaining({ field }));
      });
    }

    test('reports every invalid field at once', async ({ api }) => {
      const res = await api.createBooking({ flightId: flight.id, fare: 'SAVER', passengers: [{}], contact: {}, payment: {} });
      const fields = (await res.json()).error.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['passengers[0].title', 'passengers[0].firstName', 'contact.email', 'payment.number', 'payment.cvv']));
    });

    test('unknown flight returns 404', async ({ api }) => {
      const res = await api.createBooking(bookingRequest({ flightId: 'SL1999-20300101' }));
      expect(res.status()).toBe(404);
    });
  });

  test.describe('cancellation', () => {
    const refundRules: Array<[FareCode, (b: Booking) => number]> = [
      ['SAVER', (b) => b.price.taxes],
      ['STANDARD', (b) => b.price.total - PRICING.standardCancelFee * b.passengers.length],
      ['FLEX', (b) => b.price.total],
    ];

    for (const [fare, expectedRefund] of refundRules) {
      test(`${fare} fare refunds according to the fare rules`, async ({ api }) => {
        const booking = await api.json<Booking>(api.createBooking(bookingRequest({ fare, passengers: party(2) })), 201);
        const cancelled = await api.json<Booking>(api.cancelBooking(booking.pnr, booking.passengers[0].lastName));
        expect(cancelled.status).toBe('CANCELLED');
        expect(cancelled.refund).toEqual({ amount: expectedRefund(booking), currency: 'AED' });
      });
    }

    test('cancelling returns the seats to inventory', async ({ api }) => {
      const own = await dedicatedFlight(api, 44);
      const booking = await api.json<Booking>(api.createBooking(bookingRequest({ flightId: own.id, passengers: party(2) })), 201);
      expect((await api.json<Flight>(api.flight(own.id))).seatsAvailable).toBe(98);
      await api.json(api.cancelBooking(booking.pnr, booking.passengers[0].lastName));
      expect((await api.json<Flight>(api.flight(own.id))).seatsAvailable).toBe(100);
    });

    test('cancelling twice returns 409 ALREADY_CANCELLED', async ({ api }) => {
      const booking = await api.json<Booking>(api.createBooking(bookingRequest()), 201);
      const lastName = booking.passengers[0].lastName;
      await api.json(api.cancelBooking(booking.pnr, lastName));
      const again = await api.cancelBooking(booking.pnr, lastName);
      expect(again.status()).toBe(409);
      expect((await again.json()).error.code).toBe('ALREADY_CANCELLED');
    });

    test('cancelling needs the right last name', async ({ api }) => {
      const booking = await api.json<Booking>(api.createBooking(bookingRequest()), 201);
      expect((await api.cancelBooking(booking.pnr, 'Wrongname')).status()).toBe(404);
      expect((await api.getBooking(booking.pnr, booking.passengers[0].lastName).then((r) => r.json())).status).toBe('CONFIRMED');
    });
  });

  test.describe('logged-in customer', () => {
    test('bookings made with a token appear in "my bookings"; guest bookings do not', async ({ api }) => {
      await api.loginAs(DEMO_USER.email, DEMO_USER.password);
      const mine = await api.json<Booking>(api.createBooking(bookingRequest()), 201);
      const token = await api.loginAs(DEMO_USER.email, DEMO_USER.password);

      api.withToken(undefined);
      const guest = await api.json<Booking>(api.createBooking(bookingRequest()), 201);

      api.withToken(token);
      const { bookings } = await api.json<{ bookings: Booking[] }>(api.myBookings());
      const pnrs = bookings.map((b) => b.pnr);
      expect(pnrs).toContain(mine.pnr);
      expect(pnrs).not.toContain(guest.pnr);
    });

    test('owner can retrieve their booking without a last name', async ({ api }) => {
      await api.loginAs(DEMO_USER.email, DEMO_USER.password);
      const booking = await api.json<Booking>(api.createBooking(bookingRequest()), 201);
      expect((await api.getBooking(booking.pnr)).status()).toBe(200);
    });

    test('"my bookings" requires authentication', async ({ api }) => {
      expect((await api.myBookings()).status()).toBe(401);
    });
  });
});
