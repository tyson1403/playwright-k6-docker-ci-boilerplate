import { Router } from 'express';
import { getAirport } from '../data/airports.js';
import { findFlight, hash, isBookable, toLocalIso } from '../services/schedule.js';
import { FARES, quote, refundAmount } from '../services/pricing.js';
import { charge, validateCard } from '../services/payment.js';
import * as store from '../store.js';
import { EMAIL_PATTERN, validatePassengers } from '../validation.js';
import { ApiError, badRequest, conflict, notFound, unprocessable } from '../errors.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { withAvailability } from './flights.js';

const router = Router();

export const CHECKIN_OPENS_HOURS = 48;
export const CHECKIN_CLOSES_MINUTES = 60;
const SEAT_ROWS = 30;
const SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const publicBooking = ({ userId, idempotencyKey, ...booking }) => booking;

/**
 * Looks up a booking the caller is allowed to see: either they know the
 * PNR + a passenger's last name, or they are the logged-in owner.
 * Returns 404 in every failure case so PNRs can't be enumerated.
 */
function authorisedBooking(req, lastName) {
  const booking = store.getBooking(req.params.pnr);
  if (!booking) throw notFound('Booking not found');
  const ownsBooking = req.user && booking.userId === req.user.id;
  const nameMatches = lastName && booking.passengers.some((p) => p.lastName.toLowerCase() === String(lastName).trim().toLowerCase());
  if (!ownsBooking && !nameMatches) throw notFound('Booking not found');
  return booking;
}

function checkinWindow(booking, now = Date.now()) {
  const departure = Date.parse(booking.flight.departureUtc);
  const opensAt = departure - CHECKIN_OPENS_HOURS * 3_600_000;
  const closesAt = departure - CHECKIN_CLOSES_MINUTES * 60_000;
  return { opensAt, closesAt, open: now >= opensAt && now < closesAt, notYetOpen: now < opensAt };
}

function assertCanCheckIn(booking) {
  if (booking.status === 'CANCELLED') throw unprocessable('BOOKING_CANCELLED', 'This booking has been cancelled');
  const window = checkinWindow(booking);
  if (window.notYetOpen) {
    throw unprocessable('CHECKIN_NOT_OPEN', `Online check-in opens ${CHECKIN_OPENS_HOURS} hours before departure`);
  }
  if (!window.open) throw unprocessable('CHECKIN_CLOSED', `Online check-in closes ${CHECKIN_CLOSES_MINUTES} minutes before departure`);
}

const seatLabels = () => Array.from({ length: SEAT_ROWS }, (_, r) => SEAT_LETTERS.map((l) => `${r + 1}${l}`)).flat();

/** ~30% of seats are pre-assigned to "other travellers" so the map looks realistic. */
function isSeatTaken(flightId, seat) {
  return hash(`${flightId}:${seat}`) % 10 < 3 || store.occupiedSeats(flightId).has(seat);
}

function boardingPasses(booking) {
  const origin = getAirport(booking.flight.origin);
  const boardingUtc = Date.parse(booking.flight.departureUtc) - 45 * 60_000;
  const gate = `B${(hash(booking.flight.id) % 30) + 1}`;
  return booking.passengers.map((p, i) => ({
    passengerId: p.id,
    passengerName: `${p.lastName}/${p.firstName} ${p.title}`.toUpperCase(),
    pnr: booking.pnr,
    flightNumber: booking.flight.flightNumber,
    origin: booking.flight.origin,
    destination: booking.flight.destination,
    departureTime: booking.flight.departureTime,
    boardingTime: toLocalIso(boardingUtc, origin.utcOffset),
    gate,
    seat: p.seat,
    sequence: String(i + 1).padStart(3, '0'),
    barcode: `M1${booking.pnr}${booking.flight.flightNumber}${p.seat}`,
  }));
}

// ---------------------------------------------------------------------------

router.post('/', optionalAuth, (req, res) => {
  const idempotencyKey = req.get('idempotency-key');
  if (idempotencyKey) {
    const existing = store.getBooking(store.getIdempotentPnr(idempotencyKey));
    if (existing) {
      res.set('Idempotent-Replay', 'true');
      return res.status(200).json(publicBooking(existing));
    }
  }

  const { flightId, fare, passengers, contact, extraBag = false, payment } = req.body || {};

  const errors = [...validatePassengers(passengers), ...validateCard(payment)];
  if (!FARES[fare]) errors.push({ field: 'fare', message: `Fare must be one of ${Object.keys(FARES).join(', ')}` });
  if (!EMAIL_PATTERN.test(contact?.email || '')) errors.push({ field: 'contact.email', message: 'A valid contact email is required' });
  if (typeof extraBag !== 'boolean') errors.push({ field: 'extraBag', message: 'extraBag must be true or false' });
  if (errors.length) throw badRequest('Booking details are invalid', errors);

  const flight = findFlight(flightId);
  if (!flight) throw notFound(`Flight ${flightId} not found`);
  if (!isBookable(flight)) throw unprocessable('FLIGHT_CLOSED', 'This flight is no longer open for booking');

  if (!store.reserveSeats(flight.id, passengers.length)) {
    throw conflict('SOLD_OUT', 'Not enough seats left on this flight');
  }

  const price = quote({ basePrice: flight.basePrice, fareCode: fare, passengers: passengers.length, extraBag });
  const result = charge(payment, price.total);
  if (!result.approved) {
    store.releaseSeats(flight.id, passengers.length);
    throw new ApiError(402, 'PAYMENT_DECLINED', result.reason);
  }

  const pnr = store.generatePnr();
  const booking = {
    pnr,
    status: 'CONFIRMED',
    flight: { ...flight },
    fare,
    passengers: passengers.map((p, i) => ({
      id: `P${i + 1}`,
      title: p.title,
      firstName: p.firstName.trim(),
      lastName: p.lastName.trim(),
      seat: null,
      checkedIn: false,
    })),
    contact: { email: contact.email.toLowerCase(), phone: contact.phone || null },
    extraBag,
    price,
    payment: { cardLast4: result.cardLast4, authCode: result.authCode },
    userId: req.user?.id || null,
    createdAt: new Date().toISOString(),
  };
  store.saveBooking(booking);
  if (idempotencyKey) store.rememberIdempotentPnr(idempotencyKey, pnr);

  res.status(201).location(`/api/bookings/${pnr}`).json(publicBooking(booking));
});

router.get('/', requireAuth, (req, res) => {
  const bookings = store
    .bookingsForUser(req.user.id)
    .sort((a, b) => a.flight.departureUtc.localeCompare(b.flight.departureUtc))
    .map(publicBooking);
  res.json({ bookings });
});

router.get('/:pnr', optionalAuth, (req, res) => {
  const booking = authorisedBooking(req, req.query.lastName);
  const window = checkinWindow(booking);
  res.json({
    ...publicBooking(booking),
    checkin: {
      opensAt: new Date(window.opensAt).toISOString(),
      closesAt: new Date(window.closesAt).toISOString(),
      open: booking.status === 'CONFIRMED' && window.open,
    },
  });
});

router.post('/:pnr/cancel', optionalAuth, (req, res) => {
  const booking = authorisedBooking(req, req.body?.lastName);
  if (booking.status === 'CANCELLED') throw conflict('ALREADY_CANCELLED', 'This booking is already cancelled');
  if (booking.passengers.some((p) => p.checkedIn)) {
    throw unprocessable('ALREADY_CHECKED_IN', 'Bookings cannot be cancelled after check-in');
  }
  if (Date.parse(booking.flight.departureUtc) <= Date.now()) {
    throw unprocessable('FLIGHT_DEPARTED', 'This flight has already departed');
  }

  booking.status = 'CANCELLED';
  booking.cancelledAt = new Date().toISOString();
  booking.refund = { amount: refundAmount(booking), currency: booking.price.currency };
  store.releaseSeats(booking.flight.id, booking.passengers.length);
  res.json(publicBooking(booking));
});

router.get('/:pnr/seatmap', optionalAuth, (req, res) => {
  const booking = authorisedBooking(req, req.query.lastName);
  assertCanCheckIn(booking);
  const flight = withAvailability(findFlight(booking.flight.id));
  const seats = seatLabels().map((seat) => ({ seat, available: !isSeatTaken(flight.id, seat) }));
  res.json({ flightId: flight.id, rows: SEAT_ROWS, letters: SEAT_LETTERS, seats });
});

router.post('/:pnr/checkin', optionalAuth, (req, res) => {
  const booking = authorisedBooking(req, req.body?.lastName);
  assertCanCheckIn(booking);
  if (booking.passengers.every((p) => p.checkedIn)) throw conflict('ALREADY_CHECKED_IN', 'All passengers are already checked in');

  const requested = req.body?.seats || {};
  const validSeats = new Set(seatLabels());
  const errors = [];
  const chosen = new Set();
  for (const p of booking.passengers) {
    const seat = String(requested[p.id] || '').toUpperCase();
    if (!validSeats.has(seat)) errors.push({ field: `seats.${p.id}`, message: `A valid seat is required for ${p.firstName}` });
    else if (chosen.has(seat)) errors.push({ field: `seats.${p.id}`, message: `Seat ${seat} is selected more than once` });
    else if (isSeatTaken(booking.flight.id, seat)) errors.push({ field: `seats.${p.id}`, message: `Seat ${seat} is not available` });
    chosen.add(seat);
  }
  if (errors.length) throw badRequest('Seat selection is invalid', errors);

  const occupied = store.occupiedSeats(booking.flight.id);
  for (const p of booking.passengers) {
    p.seat = String(requested[p.id]).toUpperCase();
    p.checkedIn = true;
    occupied.add(p.seat);
  }
  booking.checkedInAt = new Date().toISOString();
  res.json({ booking: publicBooking(booking), boardingPasses: boardingPasses(booking) });
});

export default router;
