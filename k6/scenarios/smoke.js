// Smoke: 1 user walks every journey once. Run on every commit to prove the
// scripts and the system work before spending time on bigger tests.
import { check } from 'k6';
import * as api from '../lib/api.js';
import { baseThresholds } from '../lib/config.js';
import { book, browse, checkIn, manageAndCancel } from '../lib/journeys.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    ...baseThresholds,
    checks: ['rate==1.0'], // smoke must be clean
    bookings_created: ['count>=1'],
  },
};

export function setup() {
  const res = api.health();
  if (res.status !== 200) throw new Error(`App is not healthy at ${res.url}: ${res.status}`);
}

export default function () {
  browse();
  check(book(), { 'booked a flight': (b) => !!b?.pnr });
  manageAndCancel();
  checkIn();
}
