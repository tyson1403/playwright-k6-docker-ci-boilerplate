// In-memory data store. Intentionally simple: the app is a system under test,
// and POST /api/test/reset puts it back into a known state between test runs.
import crypto from 'node:crypto';
import { initialSeatsAvailable } from './services/schedule.js';

export const DEMO_USER = {
  email: 'demo@skylane.test',
  password: 'Passw0rd!',
  firstName: 'Demo',
  lastName: 'Traveller',
};

const state = {
  users: new Map(), // email -> user
  sessions: new Map(), // token -> { email, expiresAt }
  bookings: new Map(), // pnr -> booking
  inventory: new Map(), // flightId -> seatsAvailable
  occupiedSeats: new Map(), // flightId -> Set of seats taken at check-in
  idempotency: new Map(), // key -> pnr
};

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hashed = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hashed}`;
}

export function verifyPassword(password, stored) {
  const [salt, hashed] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hashed, 'hex'));
}

export function reset() {
  for (const map of Object.values(state)) map.clear();
  createUser(DEMO_USER);
}

// ---- users & sessions ----
export function createUser({ email, password, firstName, lastName }) {
  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    firstName,
    lastName,
    createdAt: new Date().toISOString(),
  };
  state.users.set(user.email, user);
  return user;
}

export const findUser = (email) => state.users.get(String(email || '').toLowerCase()) || null;

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function createSession(email) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  state.sessions.set(token, { email, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function resolveSession(token) {
  const session = state.sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    state.sessions.delete(token);
    return null;
  }
  return findUser(session.email);
}

export const deleteSession = (token) => state.sessions.delete(token);

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

export const stats = () => ({
  users: state.users.size,
  bookings: state.bookings.size,
  activeSessions: state.sessions.size,
});

reset();
