import { expect, type Locator, type Page } from '@playwright/test';
import type { FareCode } from '../utils/test-data';

export class FlightResultsPage {
  readonly title: Locator;
  readonly subtitle: Locator;
  readonly flightCards: Locator;
  readonly noFlights: Locator;
  readonly alert: Locator;
  readonly modifySearch: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId('route-title');
    this.subtitle = page.getByTestId('route-subtitle');
    this.flightCards = page.getByTestId('flight-card');
    this.noFlights = page.getByTestId('no-flights');
    this.alert = page.getByTestId('results-alert');
    this.modifySearch = page.getByTestId('modify-search');
  }

  async waitForResults() {
    await expect(this.flightCards.first().or(this.noFlights).or(this.alert).filter({ visible: true }).first()).toBeVisible();
  }

  flight(flightId: string): Locator {
    return this.page.locator(`[data-testid="flight-card"][data-flight-id="${flightId}"]`);
  }

  farePrice(flightId: string, fare: FareCode): Locator {
    return this.flight(flightId).getByTestId(`fare-${fare}`).getByTestId('fare-price');
  }

  async selectFare(flightId: string, fare: FareCode) {
    await this.flight(flightId).getByTestId(`fare-${fare}`).getByRole('link', { name: /Select/ }).click();
    await this.page.waitForURL(/\/book\?/);
  }

  async departureTimes(): Promise<string[]> {
    return this.page.getByTestId('departure-time').allTextContents();
  }
}
