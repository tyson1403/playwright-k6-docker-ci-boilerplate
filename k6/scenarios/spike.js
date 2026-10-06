// Spike: a flash sale. Traffic jumps from normal to 10x in seconds, stays briefly,
// then drops. We check the system survives and recovers - not that it stays fast.
import { baseThresholds } from '../lib/config.js';
import { book, browse } from '../lib/journeys.js';

export const options = {
  scenarios: {
    flash_sale_browsers: {
      executor: 'ramping-vus',
      exec: 'browsers',
      stages: [
        { duration: '30s', target: 10 }, // normal
        { duration: '10s', target: 150 }, // sale email lands
        { duration: '1m', target: 150 },
        { duration: '10s', target: 10 }, // back to normal
        { duration: '1m', target: 10 }, // recovery
        { duration: '10s', target: 0 },
      ],
    },
    flash_sale_bookers: {
      executor: 'ramping-vus',
      exec: 'bookers',
      stages: [
        { duration: '30s', target: 3 },
        { duration: '10s', target: 40 },
        { duration: '1m', target: 40 },
        { duration: '10s', target: 3 },
        { duration: '1m', target: 3 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: baseThresholds.http_req_failed,
    'http_req_duration{name:GET /api/flights/search}': ['p(95)<1000'],
    'http_req_duration{name:POST /api/bookings}': ['p(95)<1500'],
    booking_success_rate: ['rate>0.98'],
  },
};

export const browsers = browse;
export const bookers = book;
