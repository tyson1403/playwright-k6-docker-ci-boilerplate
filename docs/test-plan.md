# SkyLane Air test plan

## 1. Scope

**In scope:** flight search, fares and pricing, booking and payment, manage booking (retrieve and cancel), online check-in, customer accounts (SQLite persistence, lockout, session timeout), accessibility, and performance of the public API.

**Out of scope:** real payment gateways, email delivery, multi-city or return trips, infants and children, and loyalty programmes. The app does not implement any of these.

## 2. Approach (test pyramid)

| Level | Share | Runs | Goal |
|---|---|---|---|
| Unit / integration | Business rules | Every push (seconds) | Pricing, refunds, Luhn, expiry, schedule, time zones; accounts, lockout and sessions against a real SQLite file with a fake clock |
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
| Brute-force password guessing | Lockout after 5 failures; tested at API, UI and integration level |
| Time-based rules are slow to test | Test hooks age sessions and expire locks; `page.clock` fast-forwards the browser; integration tests inject a clock |
| Shared demo account gets locked by a test | Every lockout and session test registers its own customer |
| Lost accounts on restart | SQLite on a Docker volume; CI restarts the container and logs in again |

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

### Account security

| ID | Scenario | Expected | Pri | Automated in |
|---|---|---|---|---|
| AS-01 | Failed logins below the limit | Each one counted on the account; generic 401 | P2 | `api/account-security` |
| AS-02 | 5th consecutive failure | 423 ACCOUNT_LOCKED with `Retry-After` ≈ 900s; lock time stored | P1 | `api/account-security`, `e2e/account-security` |
| AS-03 | Correct password while locked | Still 423; no session created | P1 | both |
| AS-04 | Success before the limit | Counter resets; a fresh set of attempts | P2 | `api/account-security`, `app/test/accounts` |
| AS-05 | Lock expires | Login works; counter starts again rather than re-locking | P1 | all three levels |
| AS-06 | Email in different case or with spaces | Counts against the same account | P3 | `api/account-security` |
| AS-07 | Another customer while one is locked | Unaffected | P2 | `api/account-security` |
| AS-08 | Unknown email, many attempts | Always 401, never 423 (no enumeration) | P2 | `api/account-security`, `app/test/accounts` |
| AS-09 | Already signed-in session when the account locks | Keeps working | P3 | `api/account-security` |
| ST-01 | Login | Returns `expiresAt` (8h), `idleExpiresAt` and `idleTimeoutSeconds` (900) | P2 | `api/account-security` |
| ST-02 | Idle for longer than 15 min | 401 SESSION_EXPIRED; session deleted | P1 | `api/account-security`, `app/test/accounts` |
| ST-03 | Idle for 14 min | Still valid | P2 | `api/account-security` |
| ST-04 | Regular activity | Idle window slides; session stays valid past 15 min | P1 | `api/account-security`, `app/test/accounts` |
| ST-05 | Active for more than 8h | Ends at the absolute limit | P2 | `api/account-security`, `app/test/accounts` |
| ST-06 | Expired token used to book | 401 SESSION_EXPIRED, not a silent guest booking | P1 | `api/account-security` |
| ST-07 | Two devices; log out one | The other stays signed in | P2 | `api/account-security`, `app/test/accounts` |
| ST-08 | Browser idle for 14 min | "Are you still there?" warning with a countdown | P1 | `e2e/account-security` |
| ST-09 | "Stay signed in" | Session extended on the server; timer restarts | P1 | `e2e/account-security` |
| ST-10 | Browser idle for 15 min | Signed out on the client and server; login page explains why; returns to the same page after login | P1 | `e2e/account-security` |
| ST-11 | Escape on the warning / "Log out now" | Warning stays / signs out | P3 | `e2e/account-security` |
| ST-12 | Session expired on the server, then the page is reloaded | Protected page: redirect to login and back. Public page: notice, stays on the page | P2 | `e2e/account-security`, `hybrid/my-trips` |
| DB-01 | Database closed and reopened | Accounts still log in; migrations don't re-run | P1 | `app/test/accounts`, CI container restart |
| DB-02 | Storage of secrets | Salted scrypt password hashes; session tokens stored only as SHA-256 | P1 | `app/test/accounts` |
| DB-03 | Duplicate email in another case | Rejected by the unique, case-insensitive index | P2 | `app/test/accounts`, `api/auth` |
| DB-04 | Expired sessions | Purged a day after expiry, so customers see "expired" rather than "invalid" | P3 | `app/test/accounts` |

### Non-functional

| ID | Scenario | Expected | Automated in |
|---|---|---|---|
| NF-01 | axe scan: home, results, booking (with errors), seat map, session-timeout warning | No serious or critical WCAG 2.1 AA issues | `e2e/accessibility` |
| NF-02 | Keyboard-only form completion, skip link | Logical focus order | `e2e/accessibility` |
| NF-03 | Mobile viewport (Pixel 7) | `@smoke` journeys pass | `mobile-chrome` project |
| NF-04 | Load / stress / spike | SLOs in section 4 | `k6/scenarios/*` |

## 7. Planned: phase 2

A forgot-password flow will build on the SQLite layer: a new migration for single-use, time-limited reset tokens (stored hashed), an emailed reset link (captured by a test mailbox), password-reset rate limiting, and revoking all of the user's sessions once the password changes (`deleteSessionsForUser` already exists for this).
