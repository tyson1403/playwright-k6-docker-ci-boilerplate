// Stress: keep increasing the arrival rate past normal load to find where the
// system starts to degrade. Uses an open model (arrival rate), so slow responses
// don't hide load the way a fixed number of VUs would.
import * as api from '../lib/api.js';
import { dubaiDate, randomInt, randomRoute } from '../lib/data.js';
import { book } from '../lib/journeys.js';

export const options = {
  scenarios: {
    search_pressure: {
      executor: 'ramping-arrival-rate',
      exec: 'search',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '1m', target: 300 },
        { duration: '30s', target: 0 },
      ],
    },
    booking_pressure: {
      executor: 'ramping-arrival-rate',
      exec: 'booking',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500, // each booking journey includes ~8s of think time
      stages: [
        { duration: '1m', target: 5 },
        { duration: '2m', target: 15 },
        { duration: '1m', target: 25 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Looser than load SLOs: we want to observe degradation, but stop if it collapses.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    'http_req_duration{name:GET /api/flights/search}': [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '30s' }],
    dropped_iterations: ['count<100'],
  },
};

export function search() {
  api.searchFlights({ ...randomRoute(), date: dubaiDate(randomInt(2, 120)), passengers: randomInt(1, 4) });
}

export const booking = book;
