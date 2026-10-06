// Bookings and seat inventory live in memory; accounts and sessions are persisted
// in SQLite (see services/accounts.js). POST /api/test/reset restores a known state.
import crypto from 'node:crypto';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { createAccounts } from './services/accounts.js';
import { initialSeatsAvailable } from './services/schedule.js';

export const DEMO_USER = {
  email: 'demo@skylane.test',
  password: 'Passw0rd!',
  firstName: 'Demo',
  lastName: 'Traveller',
};

export const accounts = createAccounts(openDatabase(config.dbPath), config.auth);

const state = {
  bookings: new Map(), // pnr -> booking
  inventory: new Map(), // flightId -> seatsAvailable
  occupiedSeats: new Map(), // flightId -> Set of seats taken at check-in
  idempotency: new Map(), // key -> pnr
};

export function reset() {
  for (const map of Object.values(state)) map.clear();
  accounts.reset([DEMO_USER]);
}

/** The demo user always exists, even on a fresh database. */
function ensureDemoUser() {
  if (!accounts.findByEmail(DEMO_USER.email)) accounts.createUser(DEMO_USER);
}

// ---- inventory ----
export function seatsAvailable(flightId) {
  if (!state.inventory.has(flightId)) state.inventory.set(flightId, initialSeatsAvailable(flightId));
  return state.inventory.get(flightId);
}

export function setSeatsAvailable(flightId, seats) {
  state.inventory.set(flightId, seats);
}

/** Atomically reserves seats. Node runs this synchronously, so no overselling. */
export function reserveSeats(flightId, count) {
  const available = seatsAvailable(flightId);
  if (available < count) return false;
  state.inventory.set(flightId, available - count);
  return true;
}

export function releaseSeats(flightId, count) {
  state.inventory.set(flightId, seatsAvailable(flightId) + count);
}

export function occupiedSeats(flightId) {
  if (!state.occupiedSeats.has(flightId)) state.occupiedSeats.set(flightId, new Set());
  return state.occupiedSeats.get(flightId);
}

// ---- bookings ----
const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

export function generatePnr() {
  let pnr;
  do {
    pnr = Array.from(crypto.randomBytes(6), (b) => PNR_ALPHABET[b % PNR_ALPHABET.length]).join('');
  } while (state.bookings.has(pnr));
  return pnr;
}

export const saveBooking = (booking) => state.bookings.set(booking.pnr, booking);
export const getBooking = (pnr) => state.bookings.get(String(pnr || '').toUpperCase()) || null;
export const bookingsForUser = (userId) => [...state.bookings.values()].filter((b) => b.userId === userId);

export const getIdempotentPnr = (key) => state.idempotency.get(key) || null;
export const rememberIdempotentPnr = (key, pnr) => state.idempotency.set(key, pnr);

export const stats = () => ({ ...accounts.counts(), bookings: state.bookings.size });

ensureDemoUser();
