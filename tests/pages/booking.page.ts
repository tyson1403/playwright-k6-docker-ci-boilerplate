import { expect, type Locator, type Page } from '@playwright/test';
import type { Card, Passenger } from '../utils/test-data';

const TITLE_LABELS = { MR: 'Mr', MRS: 'Mrs', MS: 'Ms' } as const;

export class BookingPage {
  readonly alert: Locator;
  readonly extraBag: Locator;
  readonly payButton: Locator;
  readonly contactEmail: Locator;
  readonly priceFare: Locator;
  readonly priceTaxes: Locator;
  readonly priceExtras: Locator;
  readonly priceTotal: Locator;
  readonly summaryFlight: Locator;
  readonly summaryFare: Locator;

  constructor(private readonly page: Page) {
    this.alert = page.getByTestId('book-alert');
    this.extraBag = page.getByLabel(/extra baggage/i);
    this.payButton = page.getByRole('button', { name: 'Pay and book' });
    this.contactEmail = page.getByLabel('Email');
    this.priceFare = page.getByTestId('price-fare');
    this.priceTaxes = page.getByTestId('price-taxes');
    this.priceExtras = page.getByTestId('price-extras');
    this.priceTotal = page.getByTestId('price-total');
    this.summaryFlight = page.getByTestId('summary-flight');
    this.summaryFare = page.getByTestId('summary-fare');
  }

  async goto(flightId: string, fare: string, passengers = 1) {
    await this.page.goto(`/book?${new URLSearchParams({ flightId, fare, passengers: String(passengers) })}`);
    await this.waitForReady();
  }

  async waitForReady() {
    await expect(this.priceTotal).toBeVisible();
  }

  passengerBlock(index: number): Locator {
    return this.page.getByTestId(`passenger-${index + 1}`);
  }

  fieldError(testId: string): Locator {
    return this.page.getByTestId(`${testId}-error`);
  }

  async fillPassengers(passengers: Passenger[]) {
    for (const [i, p] of passengers.entries()) {
      const block = this.passengerBlock(i);
      await block.getByLabel('Title').selectOption({ label: TITLE_LABELS[p.title] });
      await block.getByLabel('First name').fill(p.firstName);
      await block.getByLabel('Last name').fill(p.lastName);
    }
  }

  async fillContact(email: string, phone?: string) {
    await this.contactEmail.fill(email);
    if (phone) await this.page.getByLabel('Mobile (optional)').fill(phone);
  }

  async fillPayment(card: Card) {
    await this.page.getByLabel('Name on card').fill(card.holder);
    await this.page.getByLabel('Card number').fill(card.number);
    await this.page.getByLabel('Expiry (MM/YY)').fill(card.expiry);
    await this.page.getByLabel('CVV').fill(card.cvv);
  }

  async pay() {
    await this.payButton.click();
  }

  async completeBooking({ passengers, email, card, extraBag = false }: { passengers: Passenger[]; email: string; card: Card; extraBag?: boolean }) {
    await this.fillPassengers(passengers);
    await this.fillContact(email);
    if (extraBag) {
      await this.extraBag.check();
      await expect(this.priceExtras).not.toHaveText(/AED 0$/);
    }
    await this.fillPayment(card);
    await this.pay();
  }

  /** Reads "AED 1,234" from the summary as a number. */
  async totalAmount(): Promise<number> {
    return Number((await this.priceTotal.textContent())!.replace(/[^\d]/g, ''));
  }
}
