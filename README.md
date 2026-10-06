# SkyLane Air: airline test automation demo

A small but realistic airline booking app, plus the full test suite around it:

| Layer | Tooling | What it covers |
|---|---|---|
| Unit | Node test runner | Pricing, refunds, card validation, schedule and time zones |
| API | Playwright `request` | Every endpoint: contracts, validation, business rules, security, concurrency |
| UI (E2E) | Playwright + Page Objects | Search, booking, payment errors, manage/cancel, check-in with seat map, accounts |
| Hybrid | Playwright (API setup + UI checks) | Fast, independent UI tests that create their own data through the API |
| Accessibility | axe-core | WCAG 2.1 AA scans of the key pages, plus keyboard navigation |
| Performance | k6 | Smoke, load, stress, spike, and an oversell (race condition) test |
| Delivery | Docker Compose + GitHub Actions | App, Playwright and k6 all run in containers; CI on every push |

> SkyLane Air is fictional. It has no connection to any real airline.

## The application

A hub-and-spoke low-cost carrier based in Dubai (DXB), flying to 11 cities in the Gulf, the Indian subcontinent and beyond.

- **Search**: one-way, 1–9 passengers. Only routes through DXB exist. Times are shown in each airport's local time zone.
- **Fares**: Saver (cabin bag only, non-refundable), Standard (+20kg, refundable less AED 200 per passenger), Flex (+30kg, fully refundable).
- **Book and pay**: passenger details, optional extra bag, mock card payment, and a 6-character PNR.
- **Manage booking**: retrieve by PNR + last name, then cancel with a refund calculated from the fare rules.
- **Online check-in**: opens 48h and closes 60 min before departure. Includes a seat map and boarding passes.
- **Accounts**: register, log in, and "My trips".

Built with Node.js and Express, a plain HTML/JS frontend (no build step), and an in-memory store. The flight schedule is generated deterministically, so every environment sees the same flights without needing a database.

### Test hooks (only when `ENABLE_TEST_API=true`)

| Endpoint | Purpose |
|---|---|
| `POST /api/test/reset` | Restore the known starting state (runs once before each Playwright run) |
| `PUT /api/test/flights/:id/inventory` | Set the seats left on a flight, for sold-out and race-condition tests |

### Test data

| | |
|---|---|
| Demo account | `demo@skylane.test` / `Passw0rd!` |
| Card: approved | `4111 1111 1111 1111`, any future expiry, any 3-digit CVV |
| Card: declined | `4000 0000 0000 0002` |
| Card: insufficient funds | `4000 0000 0000 9995` |

## Quick start

Requires Node 22+ (and Docker for the container and k6 commands).

```bash
npm ci && npm ci --prefix app
npx playwright install chromium

npm run app:start          # http://localhost:3000
npm test                   # all Playwright tests (starts the app automatically)
npm run test:unit          # unit tests
npm run report             # open the Playwright HTML report
```

Other useful commands:

```bash
npm run test:api           # API tests only
npm run test:e2e           # UI tests (desktop + mobile)
npm run test:smoke         # @smoke-tagged critical paths
npm run test:headed        # watch the browser
npm run typecheck
```

### With Docker

```bash
npm run docker:up          # build and start the app container
npm run docker:test        # run Playwright inside the official Playwright image
npm run k6:smoke           # k6 smoke (also k6:load, k6:stress, k6:spike, k6:oversell)
npm run docker:down
```

k6 writes an HTML dashboard to `k6-results/k6-report.html`.

To run k6 without Docker against a local app: `k6 run -e BASE_URL=http://127.0.0.1:3000 k6/scenarios/smoke.js`.

## Project layout

```
app/                      the system under test
  src/                    Express API: routes, services (schedule, pricing, payment), store
  public/                 HTML/CSS/JS frontend
  test/                   unit tests
tests/
  api/                    API tests
  e2e/                    UI tests (search, booking, auth, accessibility)
  hybrid/                 API setup → UI verification (manage, check-in, my trips)
  pages/                  Page Objects
  fixtures/               custom Playwright fixtures (api client, page objects, logged-in page)
  utils/                  typed API client, test data builders
k6/
  lib/                    config/SLOs, API wrappers, user journeys, custom metrics
  scenarios/              smoke, load, stress, spike, oversell
docs/test-plan.md         test strategy and test case catalogue
.github/workflows/        ci.yml (every push), perf.yml (nightly / on demand)
```

## Design decisions worth discussing

- **Tests own their data.** Each test creates the bookings it needs through the API, so tests run in parallel, in any order, and repeatedly. The suite is checked with `--repeat-each=3`.
- **Hybrid tests.** Booking through the UI takes about 10 seconds; through the API it takes milliseconds. Only the booking-flow tests go through the full UI. Manage and check-in tests set up through the API and verify in the UI.
- **Isolation by route.** Tests that change seat inventory use their own route or date, so parallel workers never interfere with each other. Seat selection is randomised so parallel check-ins don't collide.
- **The UI is checked against the API.** For example, the results page must show exactly the flights and prices the search API returns.
- **Stable locators.** Role and label locators come first (they double as accessibility checks), with `data-testid` for dynamic content.
- **Idempotency.** `POST /api/bookings` accepts an `Idempotency-Key`. The UI sends one per page load, and a test proves that a double-click charges once.
- **Concurrency.** Both Playwright and k6 race many buyers for the last seats and assert exactly N succeed, the rest get `409 SOLD_OUT`, and nothing is oversold.
- **Security behaviours.** No PNR or account enumeration (identical 404 and 401 responses), card numbers are never stored, and open redirects are blocked on login.
- **Performance SLOs as code.** Per-endpoint p95 thresholds in `k6/lib/config.js` fail the build when they are breached. The load mix models real traffic: about 60% browse, 25% book, 10% manage, 5% check-in.
