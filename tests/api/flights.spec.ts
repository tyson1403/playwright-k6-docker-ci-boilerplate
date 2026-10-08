import { apiTest as test, expect } from '../fixtures';
import { PRICING, ROUTES, dubaiDate } from '../utils/test-data';
import type { Flight } from '../utils/skylane-api';

test.describe('Flights API', () => {
  test('health check reports the service is up @smoke', async ({ api }) => {
    const res = await api.health();
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'skylane-air' });
  });

  test('lists airports with code, city and country', async ({ api }) => {
    const { airports } = await api.json<{ airports: Array<Record<string, string>> }>(api.airports());
    expect(airports.length).toBeGreaterThan(5);
    expect(airports).toContainEqual(expect.objectContaining({ code: 'DXB', city: 'Dubai', country: 'United Arab Emirates' }));
    for (const airport of airports) expect(airport.code).toMatch(/^[A-Z]{3}$/);
  });

  test('hub-and-spoke network: a spoke only connects to the DXB hub', async ({ api }) => {
    const { destinations } = await api.json<{ destinations: Array<{ code: string }> }>(api.destinations('KHI'));
    expect(destinations.map((d) => d.code)).toEqual(['DXB']);

    const hub = await api.json<{ destinations: Array<{ code: string }> }>(api.destinations('DXB'));
    expect(hub.destinations.map((d) => d.code)).not.toContain('DXB');
    expect(hub.destinations.length).toBeGreaterThan(5);
  });

  test('search returns bookable flights with the expected contract @smoke', async ({ api }) => {
    const date = dubaiDate(7);
    const body = await api.json<{ flights: Flight[]; routeServed: boolean }>(api.search({ ...ROUTES.search, date, passengers: 2 }));

    expect(body.routeServed).toBe(true);
    expect(body.flights.length).toBeGreaterThan(0);
    for (const flight of body.flights) {
      expect(flight).toMatchObject({ origin: 'DXB', destination: 'MCT', date, currency: 'AED', capacity: 180 });
      expect(flight.flightNumber).toMatch(/^SL\d{4}$/);
      expect(flight.id).toBe(`${flight.flightNumber}-${date.replaceAll('-', '')}`);
      expect(Date.parse(flight.arrivalUtc) - Date.parse(flight.departureUtc)).toBe(flight.durationMinutes * 60_000);
      expect(flight.fares.map((f) => f.code)).toEqual(['SAVER', 'STANDARD', 'FLEX']);
    }
  });

  test('search results are sorted by departure time', async ({ api }) => {
    const { flights } = await api.json<{ flights: Flight[] }>(api.search({ ...ROUTES.search, date: dubaiDate(10) }));
    const departures = flights.map((f) => f.departureUtc);
    expect(departures).toEqual([...departures].sort());
  });

  test('fares are priced Saver < Standard < Flex', async ({ api }) => {
    const flight = await api.findFlight({ ...ROUTES.search, date: dubaiDate(12) });
    const [saver, standard, flex] = flight.fares.map((f) => f.price);
    expect(saver).toBe(flight.basePrice);
    expect(standard).toBe(Math.round(flight.basePrice * 1.4));
    expect(flex).toBe(Math.round(flight.basePrice * 1.9));
  });

  test('schedule is deterministic: the same search returns the same flights', async ({ api }) => {
    const params = { ...ROUTES.search, date: dubaiDate(30) };
    const first = await api.json<{ flights: Flight[] }>(api.search(params));
    const second = await api.json<{ flights: Flight[] }>(api.search(params));
    expect(second.flights.map((f) => [f.id, f.basePrice])).toEqual(first.flights.map((f) => [f.id, f.basePrice]));
  });

  test('an unserved route returns no flights rather than an error', async ({ api }) => {
    const body = await api.json<{ flights: Flight[]; routeServed: boolean }>(
      api.search({ origin: 'KHI', destination: 'BOM', date: dubaiDate(5) }),
    );
    expect(body.routeServed).toBe(false);
    expect(body.flights).toEqual([]);
  });

  test('inbound flights to the hub show local times for each airport', async ({ api }) => {
    const flight = await api.findFlight({ ...ROUTES.inbound, date: dubaiDate(5) });
    expect(flight.departureTime).toMatch(/\+03:00$/); // Istanbul
    expect(flight.arrivalTime).toMatch(/\+04:00$/); // Dubai
  });

  const invalidSearches = [
    { name: 'date in the past', params: { origin: 'DXB', destination: 'MCT', date: dubaiDate(-1) }, field: 'date' },
    { name: 'date beyond the booking horizon', params: { origin: 'DXB', destination: 'MCT', date: dubaiDate(400) }, field: 'date' },
    { name: 'malformed date', params: { origin: 'DXB', destination: 'MCT', date: '2026-02-30' }, field: 'date' },
    { name: 'same origin and destination', params: { origin: 'DXB', destination: 'DXB', date: dubaiDate(3) }, field: 'destination' },
    { name: 'unknown airport', params: { origin: 'XXX', destination: 'DXB', date: dubaiDate(3) }, field: 'origin' },
    { name: 'zero passengers', params: { origin: 'DXB', destination: 'MCT', date: dubaiDate(3), passengers: 0 }, field: 'passengers' },
    { name: 'ten passengers', params: { origin: 'DXB', destination: 'MCT', date: dubaiDate(3), passengers: 10 }, field: 'passengers' },
  ];

  for (const { name, params, field } of invalidSearches) {
    test(`search rejects ${name} with 400`, async ({ api }) => {
      const res = await api.search(params);
      expect(res.status()).toBe(400);
      const { error } = await res.json();
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toContainEqual(expect.objectContaining({ field }));
    });
  }

  test('get flight by id returns the same flight as search', async ({ api }) => {
    const flight = await api.findFlight({ ...ROUTES.search, date: dubaiDate(8) });
    const fetched = await api.json<Flight & { bookable: boolean }>(api.flight(flight.id));
    expect(fetched).toMatchObject({ id: flight.id, basePrice: flight.basePrice, departureUtc: flight.departureUtc, bookable: true });
  });

  test('unknown flight id returns 404', async ({ api }) => {
    for (const id of ['SL9999-20260101', 'not-a-flight', 'SL1990-20261001']) {
      expect((await api.flight(id)).status(), id).toBe(404);
    }
  });

  test('quote totals fare, taxes and extras per passenger', async ({ api }) => {
    const flight = await api.findFlight({ ...ROUTES.search, date: dubaiDate(9) });
    const standard = flight.fares.find((f) => f.code === 'STANDARD')!.price;
    const quote = await api.json<Record<string, number>>(api.quote(flight.id, { fare: 'STANDARD', passengers: 3, extraBag: true }));
    expect(quote).toMatchObject({
      fare: standard * 3,
      taxes: PRICING.taxesPerPassenger * 3,
      extras: PRICING.extraBagPrice * 3,
      total: (standard + PRICING.taxesPerPassenger + PRICING.extraBagPrice) * 3,
    });
  });

  test('unknown API routes return a JSON 404', async ({ request }) => {
    const res = await request.get('/api/does-not-exist');
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });
});
