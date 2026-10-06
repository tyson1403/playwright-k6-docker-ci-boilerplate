// Generates a deterministic flight schedule for any route/date, so the app
// needs no seed database and every environment sees the same flights.
import { AIRPORTS, HUB, getAirport, isServedRoute } from '../data/airports.js';

export const AIRCRAFT_CAPACITY = 180; // 30 rows x 6 seats
export const BOOKING_CUTOFF_MINUTES = 120;
export const MAX_DAYS_AHEAD = 330;

const DEPARTURE_SLOTS = ['02:15', '06:40', '09:05', '13:30', '16:55', '20:10', '23:45'];

export function hash(str) {
  // FNV-1a, 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Today's date (YYYY-MM-DD) in the airport's local time zone. */
export function localToday(airport, now = Date.now()) {
  return new Date(now + airport.utcOffset * 60_000).toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const { y, m, d } = parseIsoDate(isoDate);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function toLocalIso(utcMs, utcOffset) {
  const local = new Date(utcMs + utcOffset * 60_000).toISOString().slice(0, 19);
  const sign = utcOffset >= 0 ? '+' : '-';
  const abs = Math.abs(utcOffset);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function routeKey(from, to) {
  // Direction digit (1 = out of hub, 2 = into hub) + 2-digit spoke index.
  const spoke = from === HUB ? to : from;
  const idx = AIRPORTS.findIndex((a) => a.code === spoke);
  return `${from === HUB ? 1 : 2}${String(idx).padStart(2, '0')}`;
}

function departuresPerDay(from, to) {
  return 2 + (hash(`${from}${to}`) % 2); // 2 or 3 daily
}

function basePrice(spoke, flightNo, date) {
  const variance = 0.85 + (hash(`${flightNo}|${date}`) % 51) / 100; // 0.85 - 1.35
  const { y, m, d } = parseIsoDate(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const weekend = weekday === 4 || weekday === 5 ? 1.1 : 1; // Thu/Fri peak
  return Math.round((250 + spoke.blockMinutes * 2.2) * variance * weekend);
}

export function initialSeatsAvailable(flightId) {
  return AIRCRAFT_CAPACITY - (30 + (hash(flightId) % 120));
}

function buildFlight(from, to, date, k) {
  const origin = getAirport(from);
  const destination = getAirport(to);
  const spoke = from === HUB ? destination : origin;
  const flightNo = `SL${routeKey(from, to)}${k}`;
  const slotIndex = (hash(`${from}${to}`) + k * 3) % DEPARTURE_SLOTS.length;
  const [hh, mm] = DEPARTURE_SLOTS[slotIndex].split(':').map(Number);
  const { y, m, d } = parseIsoDate(date);
  const departureUtc = Date.UTC(y, m - 1, d, hh, mm) - origin.utcOffset * 60_000;
  const arrivalUtc = departureUtc + spoke.blockMinutes * 60_000;
  const id = `${flightNo}-${date.replaceAll('-', '')}`;

  return {
    id,
    flightNumber: flightNo,
    origin: origin.code,
    destination: destination.code,
    date,
    departureTime: toLocalIso(departureUtc, origin.utcOffset),
    arrivalTime: toLocalIso(arrivalUtc, destination.utcOffset),
    departureUtc: new Date(departureUtc).toISOString(),
    arrivalUtc: new Date(arrivalUtc).toISOString(),
    durationMinutes: spoke.blockMinutes,
    aircraft: 'Boeing 737 MAX 8',
    capacity: AIRCRAFT_CAPACITY,
    basePrice: basePrice(spoke, flightNo, date),
  };
}

/** All scheduled flights for a route on a local date (ignores the booking cutoff). */
export function flightsForRoute(from, to, date) {
  if (!isServedRoute(from, to)) return [];
  const count = departuresPerDay(from, to);
  const flights = [];
  for (let k = 0; k < count; k++) {
    flights.push(buildFlight(from, to, date, k));
  }
  return flights.sort((a, b) => a.departureUtc.localeCompare(b.departureUtc));
}

/** Resolves a flight id like "SL1031-20261010" back to its schedule entry. */
export function findFlight(id) {
  const match = /^SL([12])(\d{2})(\d)-(\d{4})(\d{2})(\d{2})$/.exec(String(id || ''));
  if (!match) return null;
  const [, dir, idx, k, y, m, d] = match;
  const spoke = AIRPORTS[Number(idx)];
  if (!spoke || spoke.code === HUB) return null;
  const date = `${y}-${m}-${d}`;
  if (!parseIsoDate(date)) return null;
  const [from, to] = dir === '1' ? [HUB, spoke.code] : [spoke.code, HUB];
  return flightsForRoute(from, to, date).find((f) => f.flightNumber.endsWith(k) && f.id === id) || null;
}

export function isBookable(flight, now = Date.now()) {
  return Date.parse(flight.departureUtc) - now > BOOKING_CUTOFF_MINUTES * 60_000;
}
