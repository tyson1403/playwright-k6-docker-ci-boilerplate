export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

/** Response-time budgets (ms) per endpoint, shared by every scenario. */
export const SLO = {
  search: 300,
  flight: 200,
  quote: 200,
  booking: 500,
  retrieve: 200,
  checkin: 500,
  login: 400,
};

/** Endpoint-level thresholds. `name` tags group URLs that contain ids (e.g. /api/bookings/ABC123). */
export const endpointThresholds = {
  'http_req_duration{name:GET /api/flights/search}': [`p(95)<${SLO.search}`],
  'http_req_duration{name:GET /api/flights/:id}': [`p(95)<${SLO.flight}`],
  'http_req_duration{name:GET /api/flights/:id/quote}': [`p(95)<${SLO.quote}`],
  'http_req_duration{name:POST /api/bookings}': [`p(95)<${SLO.booking}`],
  'http_req_duration{name:GET /api/bookings/:pnr}': [`p(95)<${SLO.retrieve}`],
};

export const baseThresholds = {
  http_req_failed: ['rate<0.01'], // <1% unexpected errors
  checks: ['rate>0.99'],
  ...endpointThresholds,
};
