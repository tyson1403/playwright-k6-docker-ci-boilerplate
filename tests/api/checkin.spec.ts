import { apiTest as test, expect } from '../fixtures';
import { ROUTES, party, passenger } from '../utils/test-data';
import type { Booking, SkyLaneApi } from '../utils/skylane-api';

interface Seatmap {
  rows: number;
  letters: string[];
  seats: Array<{ seat: string; available: boolean }>;
}

interface BoardingPass {
  passengerId: string;
  passengerName: string;
  seat: string;
  gate: string;
  flightNumber: string;
  boardingTime: string;
  departureTime: string;
  barcode: string;
}

test.describe('Check-in API', () => {
  /** Random free seats, so parallel tests on the same flight don't race for the same seat. */
  async function freeSeats(api: SkyLaneApi, booking: Booking, count: number) {
    const map = await api.json<Seatmap>(api.seatmap(booking.pnr, booking.passengers[0].lastName));
    const free = map.seats.filter((s) => s.available).map((s) => s.seat);
    return free.sort(() => Math.random() - 0.5).slice(0, count);
  }

  test('seat map has 30 rows of A-F with some seats already taken', async ({ api }) => {
    const booking = await api.book({ route: ROUTES.checkin });
    const map = await api.json<Seatmap>(api.seatmap(booking.pnr, booking.passengers[0].lastName));
    expect(map.rows).toBe(30);
    expect(map.letters).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(map.seats).toHaveLength(180);
    const taken = map.seats.filter((s) => !s.available).length;
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThan(180);
  });

  test('checks in every passenger and issues boarding passes @smoke', async ({ api }) => {
    const booking = await api.book({ route: ROUTES.checkin, passengers: party(2) });
    const [s1, s2] = await freeSeats(api, booking, 2);

    const res = await api.checkin(booking.pnr, booking.passengers[0].lastName, { P1: s1, P2: s2.toLowerCase() });
    expect(res.status()).toBe(200);
    const { booking: updated, boardingPasses } = (await res.json()) as { booking: Booking; boardingPasses: BoardingPass[] };

    expect(updated.passengers.map((p) => [p.seat, p.checkedIn])).toEqual([[s1, true], [s2, true]]);
    expect(boardingPasses).toHaveLength(2);
    for (const bp of boardingPasses) {
      expect(bp.flightNumber).toBe(booking.flight.flightNumber);
      expect(bp.gate).toMatch(/^B\d{1,2}$/);
      expect(bp.barcode).toContain(booking.pnr);
      // Boarding starts 45 minutes before departure.
      expect(Date.parse(bp.departureTime) - Date.parse(bp.boardingTime)).toBe(45 * 60_000);
    }
    expect(boardingPasses[0].passengerName).toBe(`${booking.passengers[0].lastName}/OMAR MR`.toUpperCase());
  });

  test('a checked-in seat is no longer available to other travellers', async ({ api }) => {
    const first = await api.book({ route: ROUTES.checkin });
    const [seat] = await freeSeats(api, first, 1);
    await api.json(api.checkin(first.pnr, first.passengers[0].lastName, { P1: seat }));

    const second = await api.book({ route: ROUTES.checkin });
    expect(second.flight.id).toBe(first.flight.id);
    const map = await api.json<Seatmap>(api.seatmap(second.pnr, second.passengers[0].lastName));
    expect(map.seats.find((s) => s.seat === seat)?.available).toBe(false);

    const res = await api.checkin(second.pnr, second.passengers[0].lastName, { P1: seat });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.details[0].message).toBe(`Seat ${seat} is not available`);
  });

  const invalidSelections: Array<[string, (seats: string[]) => Record<string, string>, RegExp]> = [
    ['the same seat for two passengers', ([a]) => ({ P1: a, P2: a }), /selected more than once/],
    ['a seat that does not exist', ([a]) => ({ P1: a, P2: '31A' }), /valid seat is required/],
    ['a missing seat for one passenger', ([a]) => ({ P1: a }), /valid seat is required/],
  ];

  for (const [name, seats, message] of invalidSelections) {
    test(`rejects ${name}`, async ({ api }) => {
      const booking = await api.book({ route: ROUTES.checkin, passengers: party(2) });
      const free = await freeSeats(api, booking, 2);
      const res = await api.checkin(booking.pnr, booking.passengers[0].lastName, seats(free));
      expect(res.status()).toBe(400);
      expect((await res.json()).error.details.map((d: { message: string }) => d.message).join()).toMatch(message);
      // Nothing was checked in.
      const after = await api.json<Booking>(api.getBooking(booking.pnr, booking.passengers[0].lastName));
      expect(after.passengers.every((p) => !p.checkedIn)).toBe(true);
    });
  }

  test('checking in twice returns 409', async ({ api }) => {
    const booking = await api.book({ route: ROUTES.checkin });
    const [seat] = await freeSeats(api, booking, 1);
    await api.json(api.checkin(booking.pnr, booking.passengers[0].lastName, { P1: seat }));
    const again = await api.checkin(booking.pnr, booking.passengers[0].lastName, { P1: seat });
    expect(again.status()).toBe(409);
  });

  test('a checked-in booking cannot be cancelled', async ({ api }) => {
    const booking = await api.book({ route: ROUTES.checkin });
    const [seat] = await freeSeats(api, booking, 1);
    await api.json(api.checkin(booking.pnr, booking.passengers[0].lastName, { P1: seat }));
    const res = await api.cancelBooking(booking.pnr, booking.passengers[0].lastName);
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe('ALREADY_CHECKED_IN');
  });

  test('a cancelled booking cannot be checked in', async ({ api }) => {
    const booking = await api.book({ route: ROUTES.checkin });
    await api.json(api.cancelBooking(booking.pnr, booking.passengers[0].lastName));
    const res = await api.seatmap(booking.pnr, booking.passengers[0].lastName);
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe('BOOKING_CANCELLED');
  });

  test('check-in is not open more than 48 hours before departure', async ({ api }) => {
    const booking = await api.book({ route: ROUTES.checkin, daysAhead: 5, passengers: [passenger()] });
    expect(booking.checkin).toBeUndefined(); // only returned on GET
    const fetched = await api.json<Booking>(api.getBooking(booking.pnr, booking.passengers[0].lastName));
    expect(fetched.checkin?.open).toBe(false);

    const res = await api.checkin(booking.pnr, booking.passengers[0].lastName, { P1: '1A' });
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe('CHECKIN_NOT_OPEN');
  });
});
