import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from './config.js';
import { VALID_CARD, party, pick, uniqueKey } from './data.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

export function health() {
  const res = http.get(`${BASE_URL}/api/health`, { tags: { name: 'GET /api/health' } });
  check(res, { 'health is 200': (r) => r.status === 200 });
  return res;
}

export function airports() {
  const res = http.get(`${BASE_URL}/api/airports`, { tags: { name: 'GET /api/airports' } });
  check(res, { 'airports 200': (r) => r.status === 200 });
  return json(res)?.airports || [];
}

export function searchFlights({ origin, destination, date, passengers = 1 }) {
  const res = http.get(`${BASE_URL}/api/flights/search?origin=${origin}&destination=${destination}&date=${date}&passengers=${passengers}`, {
    tags: { name: 'GET /api/flights/search' },
  });
  const body = json(res);
  check(res, {
    'search 200': (r) => r.status === 200,
    'search returns flights': () => Array.isArray(body?.flights) && body.flights.length > 0,
  });
  return body?.flights || [];
}

export function getFlight(id) {
  const res = http.get(`${BASE_URL}/api/flights/${id}`, { tags: { name: 'GET /api/flights/:id' } });
  check(res, { 'flight 200': (r) => r.status === 200 });
  return json(res);
}

export function getQuote(id, fare, passengers, extraBag) {
  const res = http.get(`${BASE_URL}/api/flights/${id}/quote?fare=${fare}&passengers=${passengers}&extraBag=${extraBag}`, {
    tags: { name: 'GET /api/flights/:id/quote' },
  });
  const body = json(res);
  check(res, { 'quote 200': (r) => r.status === 200, 'quote has total': () => body?.total > 0 });
  return body;
}

/**
 * Creates a booking. `expected` lists statuses that are a valid business outcome
 * for the scenario (e.g. 409 SOLD_OUT in the oversell test), so they don't count as
 * http_req_failed.
 */
export function createBooking({ flightId, fare, passengers, extraBag = false, expected = [201] }) {
  const payload = {
    flightId,
    fare,
    passengers,
    extraBag,
    contact: { email: 'load@example.com' },
    payment: VALID_CARD,
  };
  const res = http.post(`${BASE_URL}/api/bookings`, JSON.stringify(payload), {
    headers: { ...JSON_HEADERS, 'Idempotency-Key': uniqueKey() },
    tags: { name: 'POST /api/bookings' },
    responseCallback: http.expectedStatuses(...expected),
  });
  return { res, body: json(res) };
}

export function getBooking(pnr, lastName) {
  const res = http.get(`${BASE_URL}/api/bookings/${pnr}?lastName=${encodeURIComponent(lastName)}`, {
    tags: { name: 'GET /api/bookings/:pnr' },
  });
  check(res, { 'retrieve booking 200': (r) => r.status === 200 });
  return json(res);
}

export function cancelBooking(pnr, lastName) {
  const res = http.post(`${BASE_URL}/api/bookings/${pnr}/cancel`, JSON.stringify({ lastName }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /api/bookings/:pnr/cancel' },
  });
  check(res, { 'cancel 200': (r) => r.status === 200 });
  return json(res);
}

export function seatmap(pnr, lastName) {
  const res = http.get(`${BASE_URL}/api/bookings/${pnr}/seatmap?lastName=${encodeURIComponent(lastName)}`, {
    tags: { name: 'GET /api/bookings/:pnr/seatmap' },
  });
  check(res, { 'seatmap 200': (r) => r.status === 200 });
  return json(res);
}

/** Seat conflicts (another VU took the seat) are an expected 400 under concurrency. */
export function checkin(pnr, lastName, seats) {
  return http.post(`${BASE_URL}/api/bookings/${pnr}/checkin`, JSON.stringify({ lastName, seats }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /api/bookings/:pnr/checkin' },
    responseCallback: http.expectedStatuses(200, 400),
  });
}

export function login(email, password) {
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email, password }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /api/auth/login' },
  });
  check(res, { 'login 200': (r) => r.status === 200 });
  return json(res)?.token;
}

/** Search a route and book the first flight with room for the party. */
export function searchAndBook({ route, date, size = 1, fare = pick(['SAVER', 'STANDARD', 'FLEX']), extraBag = false }) {
  const flights = searchFlights({ ...route, date, passengers: size });
  const flight = flights.find((f) => f.available);
  if (!flight) return null;
  const passengers = party(size);
  const { res, body } = createBooking({ flightId: flight.id, fare, passengers, extraBag });
  check(res, {
    'booking 201': (r) => r.status === 201,
    'booking has PNR': () => /^[A-Z0-9]{6}$/.test(body?.pnr || ''),
  });
  return res.status === 201 ? body : null;
}
