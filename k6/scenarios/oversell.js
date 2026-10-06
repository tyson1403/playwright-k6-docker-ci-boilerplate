// Concurrency / data-integrity test: 100 users race for the last 20 seats.
// Exactly 20 bookings must succeed and the rest must get 409 SOLD_OUT,
// never a 500 and never an oversold flight.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL } from '../lib/config.js';
import { createBooking } from '../lib/api.js';
import { dubaiDate, party } from '../lib/data.js';

const SEATS = Number(__ENV.SEATS || 20);
const ATTEMPTS = Number(__ENV.ATTEMPTS || 200);

const confirmed = new Counter('bookings_confirmed');
const soldOut = new Counter('bookings_sold_out');
const unexpected = new Counter('bookings_unexpected_status');

export const options = {
  scenarios: {
    race_for_last_seats: {
      executor: 'shared-iterations',
      vus: 100,
      iterations: ATTEMPTS,
      maxDuration: '1m',
    },
  },
  thresholds: {
    bookings_confirmed: [`count==${SEATS}`],
    bookings_sold_out: [`count==${ATTEMPTS - SEATS}`],
    bookings_unexpected_status: ['count==0'],
    http_req_failed: ['rate==0'], // 201 and 409 are both expected here
  },
};

export function setup() {
  // Pick a quiet flight far in the future and give it exactly SEATS seats (test-only API).
  const search = http.get(`${BASE_URL}/api/flights/search?origin=DXB&destination=KTM&date=${dubaiDate(200)}&passengers=1`).json();
  const flightId = search.flights[0].id;
  const res = http.put(`${BASE_URL}/api/test/flights/${flightId}/inventory`, JSON.stringify({ seatsAvailable: SEATS }), {
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status !== 200) throw new Error(`Could not set inventory (${res.status}). Is the test API enabled?`);
  return { flightId };
}

export default function ({ flightId }) {
  const { res } = createBooking({ flightId, fare: 'SAVER', passengers: party(1), expected: [201, 409] });
  if (res.status === 201) confirmed.add(1);
  else if (res.status === 409) soldOut.add(1);
  else unexpected.add(1);
}

export function teardown({ flightId }) {
  const flight = http.get(`${BASE_URL}/api/flights/${flightId}`).json();
  check(flight, { 'no seats left and none oversold': (f) => f.seatsAvailable === 0 });
}
