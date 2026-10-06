// Load: expected busy-day traffic with a realistic mix of users.
// Most visitors only search; a smaller share book, manage or check in.
// Scale with -e SCALE=2 (doubles the users) and -e HOLD=10m.
import * as api from '../lib/api.js';
import { baseThresholds } from '../lib/config.js';
import { book, browse, checkIn, manageAndCancel } from '../lib/journeys.js';

const SCALE = Number(__ENV.SCALE || 1);
const HOLD = __ENV.HOLD || '3m';

const users = (target) => ({
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '1m', target: Math.ceil(target * SCALE) }, // ramp up
    { duration: HOLD, target: Math.ceil(target * SCALE) }, // steady state
    { duration: '30s', target: 0 }, // ramp down
  ],
  gracefulRampDown: '30s',
});

export const options = {
  scenarios: {
    browsers: { ...users(30), exec: 'browsers' }, // ~60%
    bookers: { ...users(12), exec: 'bookers' }, // ~25%
    managers: { ...users(5), exec: 'managers' }, // ~10%
    checkins: { ...users(3), exec: 'checkins' }, // ~5%
  },
  thresholds: {
    ...baseThresholds,
    booking_success_rate: ['rate>0.99'],
    booking_journey_duration: ['p(95)<20000'], // includes think time
    'http_req_duration{scenario:bookers}': ['p(99)<1000'],
  },
};

export function setup() {
  api.health();
}

export const browsers = browse;
export const bookers = book;
export const managers = manageAndCancel;
export const checkins = checkIn;
