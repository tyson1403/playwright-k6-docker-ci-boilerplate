import { apiTest as test, expect } from '../fixtures';
import { CARDS, ROUTES, dubaiDate, party, passenger } from '../utils/test-data';
import type { Flight } from '../utils/skylane-api';

// These tests change a flight's seat inventory, so they run serially on their own route.
test.describe.configure({ mode: 'serial' });

test.describe('Seat inventory', () => {
  const bookingFor = (flightId: string, passengers = [passenger()]) => ({
    flightId,
    fare: 'SAVER',
    passengers,
    contact: { email: 'inventory@example.com' },
    payment: CARDS.valid(),
  });

  test('party larger than the remaining seats is rejected with 409 SOLD_OUT', async ({ api }) => {
    const flight = await api.flightWithSeats({ ...ROUTES.inventory, date: dubaiDate(20) }, 2);

    const res = await api.createBooking(bookingFor(flight.id, party(3)));
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe('SOLD_OUT');

    // A party that fits still books.
    expect((await api.createBooking(bookingFor(flight.id, party(2)))).status()).toBe(201);
  });

  test('search marks a flight unavailable when the party does not fit', async ({ api }) => {
    const date = dubaiDate(21);
    const flight = await api.flightWithSeats({ ...ROUTES.inventory, date }, 1);

    const { flights } = await api.json<{ flights: Flight[] }>(api.search({ ...ROUTES.inventory, date, passengers: 2 }));
    expect(flights.find((f) => f.id === flight.id)).toMatchObject({ seatsAvailable: 1, available: false });
  });

  test('concurrent bookings never oversell the last seats', async ({ api }) => {
    const seats = 3;
    const flight = await api.flightWithSeats({ ...ROUTES.inventory, date: dubaiDate(22) }, seats);

    const responses = await Promise.all(Array.from({ length: 12 }, () => api.createBooking(bookingFor(flight.id))));
    const statuses = responses.map((r) => r.status());

    expect(statuses.filter((s) => s === 201)).toHaveLength(seats);
    expect(statuses.filter((s) => s === 409)).toHaveLength(12 - seats);
    expect((await api.json<Flight>(api.flight(flight.id))).seatsAvailable).toBe(0);
  });
});
