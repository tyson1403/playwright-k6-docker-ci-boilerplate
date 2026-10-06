import { test as base, expect, type Page } from '@playwright/test';
import { SkyLaneApi } from '../utils/skylane-api';
import { DEMO_USER } from '../utils/test-data';
import { HomePage } from '../pages/home.page';
import { FlightResultsPage } from '../pages/flight-results.page';
import { BookingPage } from '../pages/booking.page';
import { ConfirmationPage } from '../pages/confirmation.page';
import { ManageBookingPage } from '../pages/manage-booking.page';
import { CheckinPage } from '../pages/checkin.page';
import { LoginPage } from '../pages/login.page';
import { Header } from '../pages/header.component';

interface Fixtures {
  api: SkyLaneApi;
  home: HomePage;
  results: FlightResultsPage;
  booking: BookingPage;
  confirmation: ConfirmationPage;
  manage: ManageBookingPage;
  checkin: CheckinPage;
  login: LoginPage;
  header: Header;
  /** A page already logged in as the demo user, without going through the login UI. */
  loggedInPage: Page;
}

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => use(new SkyLaneApi(request)),
  home: async ({ page }, use) => use(new HomePage(page)),
  results: async ({ page }, use) => use(new FlightResultsPage(page)),
  booking: async ({ page }, use) => use(new BookingPage(page)),
  confirmation: async ({ page }, use) => use(new ConfirmationPage(page)),
  manage: async ({ page }, use) => use(new ManageBookingPage(page)),
  checkin: async ({ page }, use) => use(new CheckinPage(page)),
  login: async ({ page }, use) => use(new LoginPage(page)),
  header: async ({ page }, use) => use(new Header(page)),

  loggedInPage: async ({ page, request }, use) => {
    const res = await request.post('/api/auth/login', { data: { email: DEMO_USER.email, password: DEMO_USER.password } });
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    // The app keeps its session in localStorage; seed it before any page script runs.
    await page.addInitScript((value) => {
      window.localStorage.setItem('skylane.session', value);
    }, JSON.stringify(session));
    await use(page);
  },
});

export { expect };
