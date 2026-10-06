import type { Locator, Page } from '@playwright/test';
import { BookingSummary } from './confirmation.page';

export class ManageBookingPage {
  readonly pnrInput: Locator;
  readonly lastNameInput: Locator;
  readonly findButton: Locator;
  readonly alert: Locator;
  readonly summary: BookingSummary;
  readonly cancelButton: Locator;
  readonly checkinLink: Locator;
  readonly cancelDialog: Locator;
  readonly confirmCancel: Locator;
  readonly dismissCancel: Locator;

  constructor(private readonly page: Page) {
    this.pnrInput = page.getByLabel('Booking reference');
    this.lastNameInput = page.getByLabel('Last name');
    this.findButton = page.getByRole('button', { name: 'Find booking' });
    this.alert = page.getByTestId('retrieve-alert');
    this.summary = new BookingSummary(page.getByTestId('booking-summary'));
    this.cancelButton = page.getByRole('button', { name: 'Cancel booking' });
    this.checkinLink = page.getByRole('link', { name: 'Check in now' });
    this.cancelDialog = page.getByRole('dialog', { name: 'Cancel this booking?' });
    this.confirmCancel = this.cancelDialog.getByRole('button', { name: 'Yes, cancel booking' });
    this.dismissCancel = this.cancelDialog.getByRole('button', { name: 'Keep booking' });
  }

  async goto() {
    await this.page.goto('/manage');
  }

  async retrieve(pnr: string, lastName: string) {
    await this.pnrInput.fill(pnr);
    await this.lastNameInput.fill(lastName);
    await this.findButton.click();
  }

  async cancelBooking() {
    await this.cancelButton.click();
    await this.confirmCancel.click();
  }
}
