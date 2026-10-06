import type { Locator, Page } from '@playwright/test';

/** Booking summary card, shared by the confirmation, manage-booking and trips pages. */
export class BookingSummary {
  readonly pnr: Locator;
  readonly status: Locator;
  readonly route: Locator;
  readonly flightNumber: Locator;
  readonly fare: Locator;
  readonly total: Locator;
  readonly refund: Locator;
  readonly passengerNames: Locator;
  readonly passengerSeats: Locator;
  readonly passengerCheckin: Locator;

  constructor(root: Locator) {
    this.pnr = root.getByTestId('booking-pnr');
    this.status = root.getByTestId('booking-status');
    this.route = root.getByTestId('booking-route');
    this.flightNumber = root.getByTestId('booking-flight');
    this.fare = root.getByTestId('booking-fare');
    this.total = root.getByTestId('booking-total');
    this.refund = root.getByTestId('booking-refund');
    this.passengerNames = root.getByTestId('passenger-name');
    this.passengerSeats = root.getByTestId('passenger-seat');
    this.passengerCheckin = root.getByTestId('passenger-checkin');
  }
}

export class ConfirmationPage {
  readonly message: Locator;
  readonly summary: BookingSummary;
  readonly manageLink: Locator;

  constructor(private readonly page: Page) {
    this.message = page.getByTestId('confirmation-message');
    this.summary = new BookingSummary(page.getByTestId('booking-summary'));
    this.manageLink = page.getByTestId('manage-link');
  }

  async pnr(): Promise<string> {
    return (await this.summary.pnr.textContent())!.trim();
  }
}
