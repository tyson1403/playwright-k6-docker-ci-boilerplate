// Realistic user journeys, reused by every scenario. Think times model a real user.
import { group, sleep, check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import * as api from './api.js';
import { dubaiDate, party, pick, randomInt, randomRoute } from './data.js';

export const bookingsCreated = new Counter('bookings_created');
export const bookingSuccess = new Rate('booking_success_rate');
export const bookingJourney = new Trend('booking_journey_duration', true);
export const seatConflicts = new Counter('checkin_seat_conflicts');

const think = (min = 1, max = 3) => sleep(min + Math.random() * (max - min));

/** Lookers: search a few dates on a route without booking (most real traffic). */
export function browse() {
  group('browse', () => {
    const route = randomRoute();
    api.airports();
    for (let i = 0; i < randomInt(1, 3); i++) {
      api.searchFlights({ ...route, date: dubaiDate(randomInt(2, 90)), passengers: randomInt(1, 4) });
      think(1, 2);
    }
  });
}

/** Bookers: search → choose fare → quote → pay → view booking. */
export function book() {
  const start = Date.now();
  let booking = null;
  group('book a flight', () => {
    const size = pick([1, 1, 1, 2, 2, 3, 4]);
    const route = randomRoute();
    const date = dubaiDate(randomInt(3, 120));

    const flights = api.searchFlights({ ...route, date, passengers: size });
    const flight = flights.find((f) => f.available);
    if (!flight) return;
    think();

    const fare = pick(['SAVER', 'STANDARD', 'STANDARD', 'FLEX']);
    const extraBag = Math.random() < 0.3;
    api.getFlight(flight.id);
    const quote = api.getQuote(flight.id, fare, size, extraBag);
    think(2, 5); // filling in passenger details

    const { res, body } = api.createBooking({ flightId: flight.id, fare, passengers: party(size), extraBag });
    const ok = check(res, {
      'booking 201': (r) => r.status === 201,
      'charged the quoted total': () => body?.price?.total === quote?.total,
    });
    bookingSuccess.add(ok);
    if (!ok) return;
    bookingsCreated.add(1);
    booking = body;
    think(1, 2);

    api.getBooking(body.pnr, body.passengers[0].lastName);
  });
  if (booking) bookingJourney.add(Date.now() - start);
  return booking;
}

/** Manage: book, look it up again later and sometimes cancel. */
export function manageAndCancel() {
  const booking = api.searchAndBook({ route: randomRoute(), date: dubaiDate(randomInt(5, 60)), size: randomInt(1, 3) });
  if (!booking) return;
  think();
  group('manage booking', () => {
    const lastName = booking.passengers[0].lastName;
    api.getBooking(booking.pnr, lastName);
    think();
    if (Math.random() < 0.5) {
      const cancelled = api.cancelBooking(booking.pnr, lastName);
      check(cancelled, { 'cancelled with refund': (b) => b?.status === 'CANCELLED' && b.refund?.amount >= 0 });
    }
  });
}

/** Check-in: book a flight for tomorrow, open the seat map and check in. */
export function checkIn() {
  const booking = api.searchAndBook({ route: randomRoute(), date: dubaiDate(1), size: randomInt(1, 2) });
  if (!booking) return;
  think();
  group('online check-in', () => {
    const lastName = booking.passengers[0].lastName;
    const map = api.seatmap(booking.pnr, lastName);
    if (!map) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const free = map.seats.filter((s) => s.available).sort(() => Math.random() - 0.5);
      const seats = Object.fromEntries(booking.passengers.map((p, i) => [p.id, free[i].seat]));
      const res = api.checkin(booking.pnr, lastName, seats);
      if (res.status === 200) {
        check(res, { 'boarding passes issued': (r) => r.json('boardingPasses').length === booking.passengers.length });
        return;
      }
      seatConflicts.add(1); // someone else took the seat between seat map and check-in
      Object.assign(map, api.seatmap(booking.pnr, lastName));
    }
    check(null, { 'checked in within 3 attempts': () => false });
  });
}
