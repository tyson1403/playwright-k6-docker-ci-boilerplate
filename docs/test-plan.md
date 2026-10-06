# SkyLane Air test plan

## 1. Scope

**In scope:** flight search, fares and pricing, booking and payment, manage booking (retrieve and cancel), online check-in, customer accounts, accessibility, and performance of the public API.

**Out of scope:** real payment gateways, email delivery, multi-city or return trips, infants and children, and loyalty programmes. The app does not implement any of these.

## 2. Approach (test pyramid)

| Level | Share | Runs | Goal |
|---|---|---|---|
| Unit | Business rules | Every push (seconds) | Pricing, refunds, Luhn, expiry, schedule, time zones |
| API | Most functional checks | Every push | Contracts, validation, rules, security, concurrency |
| UI / hybrid | Key journeys | Every push (Chromium); `@smoke` also on mobile | What the customer sees and does |
| Accessibility | Key pages | Every push | WCAG 2.1 AA: no serious or critical violations |
| Performance | API | Smoke and oversell every push; load nightly; stress and spike on demand | SLOs, capacity, stability, data integrity under load |

## 3. Entry and exit criteria

- **Entry:** the app is healthy (`/api/health`), the test API is enabled, and test data has been reset.
- **Exit (release):** all unit, API and UI tests pass, with no serious or critical accessibility issues, and the k6 smoke and oversell thresholds are green. Load-test SLOs must be met on the nightly run.

## 4. Performance SLOs

| Endpoint | p95 |
|---|---|
| `GET /api/flights/search` | < 300 ms |
| `GET /api/flights/:id`, `/quote` | < 200 ms |
| `POST /api/bookings` | < 500 ms |
| `GET /api/bookings/:pnr` | < 200 ms |
| Error rate | < 1% |

| k6 scenario | Model | Question it answers |
|---|---|---|
| smoke | 1 VU, every journey once | Do the scripts and the system work? |
| load | Ramping VUs, realistic mix (60/25/10/5) | Do we meet SLOs at expected peak? |
| stress | Ramping arrival rate up to 300 searches/s | Where does it start to degrade? |
| spike | 10x traffic in 10 seconds (flash sale) | Does it survive and recover? |
| oversell | 100 VUs, 200 attempts, 20 seats | Is inventory correct under a race? |

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Flaky tests from shared data | Each test creates its own data; inventory tests get their own routes; seats are picked at random |
| Date and time-zone bugs | Unit tests for local dates and offsets; browser runs pinned to Asia/Dubai; dates computed in Dubai time |
| Overselling seats | API concurrency test plus the k6 oversell scenario |
| Double charging | Idempotency key, tested through both the API and a UI double-click |
| Data leakage | Not-found responses are identical whether or not a PNR or account exists; card numbers are never returned |

## 6. Test case catalogue

Priority: **P1** = critical path (tagged `@smoke`), **P2** = important, **P3** = edge case.

### Flight search

| ID | Scenario | Expected | Pri | Automated in |
|---|---|---|---|---|
| SR-01 | Search DXB → MCT, 2 passengers | Flights listed with Saver, Standard and Flex prices matching the API | P1 | `e2e/search`, `api/flights` |
| SR-02 | Results ordering | Sorted by departure time | P2 | both |
| SR-03 | Origin is a spoke (KHI) | Only DXB offered as destination | P2 | both |
| SR-04 | Unserved route (KHI → BOM) via API | 200 with empty list, `routeServed: false` | P3 | `api/flights` |
| SR-05 | Missing destination or date | Inline field errors; no navigation | P2 | `e2e/search` |
| SR-06 | Past date, >330 days ahead, invalid date | 400 with a `date` field error | P2 | `api/flights` |
| SR-07 | Same origin and destination, unknown airport | 400 | P3 | `api/flights` |
| SR-08 | 0 or 10 passengers | 400 | P3 | `api/flights` |
| SR-09 | Flight with 0 seats | Shown as "Sold out", no Select button | P2 | `e2e/search` |
| SR-10 | Flight with ≤9 seats | "Only N seats left" badge | P3 | `e2e/search` |
| SR-11 | Modify search | Previous criteria restored | P3 | `e2e/search` |
| SR-12 | Inbound flight (IST → DXB) | Departure in +03:00, arrival in +04:00 | P2 | `api/flights` |
| SR-13 | Same search twice | Identical flights and prices (deterministic) | P3 | `api/flights` |

### Booking and payment

| ID | Scenario | Expected | Pri | Automated in |
|---|---|---|---|---|
| BK-01 | Guest books 2 passengers, Standard + bags | Confirmation with PNR; total = 2 × (fare + 85 + 95) | P1 | `e2e/booking` |
| BK-02 | Toggle extra bag | Extras and total update live | P2 | `e2e/booking` |
| BK-03 | Submit an empty form | All required fields flagged | P2 | `e2e/booking` |
| BK-04 | Invalid name, email or card | Server errors shown next to the correct field | P2 | `e2e/booking`, `api/bookings` |
| BK-05 | Declined card | 402; customer stays on page; seats released | P1 | both |
| BK-06 | Insufficient funds, then a valid card | First fails, second succeeds | P2 | `e2e/booking` |
| BK-07 | Expired card, short CVV, failed Luhn check | 400 with a field error | P2 | `api/bookings` |
| BK-08 | Double-click "Pay" / retried request | One booking, one charge (idempotency) | P1 | both |
| BK-09 | Party larger than the seats left | 409 SOLD_OUT | P1 | `api/inventory` |
| BK-10 | 12 concurrent buyers, 3 seats | Exactly 3 × 201, 9 × 409, 0 seats left | P1 | `api/inventory`, `k6/oversell` |
| BK-11 | Logged-in customer | Details pre-filled; booking shows in My trips | P2 | `e2e/booking`, `hybrid/my-trips` |
| BK-12 | Card data handling | Only the last 4 digits are stored or returned | P1 | `api/bookings` |
| BK-13 | Price consistency | Amount charged equals the quote | P1 | `api/bookings`, k6 check |

### Manage booking and cancellation

| ID | Scenario | Expected | Pri | Automated in |
|---|---|---|---|---|
| MB-01 | Retrieve with PNR + any passenger's last name (any case) | Booking shown | P1 | `hybrid/manage-booking`, `api/bookings` |
| MB-02 | Wrong last name / unknown PNR | Same "not found" response (no enumeration) | P1 | both |
| MB-03 | Malformed PNR | Client-side validation | P3 | `hybrid/manage-booking` |
| MB-04 | Cancel Saver / Standard / Flex | Refund = taxes / total − 200 per passenger / total | P1 | `api/bookings`, `hybrid/manage-booking` |
| MB-05 | "Keep booking" in the dialog | Nothing changes | P2 | `hybrid/manage-booking` |
| MB-06 | Cancel twice | 409 ALREADY_CANCELLED | P2 | `api/bookings` |
| MB-07 | Cancel after check-in | 422 ALREADY_CHECKED_IN | P2 | `api/checkin` |
| MB-08 | Cancelling returns seats to inventory | Seats available +N | P2 | `api/bookings` |

### Online check-in

| ID | Scenario | Expected | Pri | Automated in |
|---|---|---|---|---|
| CI-01 | Family of 3 picks seats and checks in | 3 boarding passes with the chosen seats | P1 | `hybrid/checkin`, `api/checkin` |
| CI-02 | Taken seats | Disabled and announced as "unavailable" | P2 | `hybrid/checkin` |
| CI-03 | Seat taken by someone else before confirming | Error, then success with another seat | P2 | `hybrid/checkin`, `api/checkin` |
| CI-04 | Same seat twice, invalid seat, missing seat | 400; nobody checked in | P2 | `api/checkin` |
| CI-05 | More than 48h before departure | "Check-in opens 48 hours before departure" | P1 | both |
| CI-06 | Already checked in | Reported; 409 from the API | P3 | both |
| CI-07 | Cancelled booking | 422 BOOKING_CANCELLED | P3 | `api/checkin` |
| CI-08 | Boarding pass | Boarding is 45 minutes before departure; gate and barcode contain the PNR | P2 | `api/checkin` |

### Accounts

| ID | Scenario | Expected | Pri | Automated in |
|---|---|---|---|---|
| AC-01 | Log in and out | Greeting shown; session cleared | P1 | `e2e/auth`, `api/auth` |
| AC-02 | Wrong password vs unknown email | Identical 401 | P1 | both |
| AC-03 | Register / duplicate email / weak password | 201 / 409 / 400 | P2 | both |
| AC-04 | Token after logout | 401 | P2 | `api/auth` |
| AC-05 | My trips while logged out or expired | Redirect to login, then back | P2 | `e2e/auth`, `hybrid/my-trips` |
| AC-06 | `?next=//evil.example.com` | No open redirect | P2 | `e2e/auth` |
| AC-07 | Malformed JSON body | 400 INVALID_JSON | P3 | `api/auth` |

### Non-functional

| ID | Scenario | Expected | Automated in |
|---|---|---|---|
| NF-01 | axe scan: home, results, booking (with errors), seat map | No serious or critical WCAG 2.1 AA issues | `e2e/accessibility` |
| NF-02 | Keyboard-only form completion, skip link | Logical focus order | `e2e/accessibility` |
| NF-03 | Mobile viewport (Pixel 7) | `@smoke` journeys pass | `mobile-chrome` project |
| NF-04 | Load / stress / spike | SLOs in section 4 | `k6/scenarios/*` |
