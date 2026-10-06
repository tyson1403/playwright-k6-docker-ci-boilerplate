import { expect, type Locator, type Page } from '@playwright/test';

export interface SearchCriteria {
  origin?: string;
  destination: string;
  date: string;
  passengers?: number;
}

export class HomePage {
  readonly origin: Locator;
  readonly destination: Locator;
  readonly date: Locator;
  readonly passengers: Locator;
  readonly searchButton: Locator;
  readonly destinationError: Locator;
  readonly dateError: Locator;

  constructor(private readonly page: Page) {
    this.origin = page.getByLabel('From');
    this.destination = page.getByLabel('To', { exact: true });
    this.date = page.getByLabel('Departure date');
    this.passengers = page.getByLabel('Passengers');
    this.searchButton = page.getByRole('button', { name: 'Search flights' });
    this.destinationError = page.getByTestId('destination-error');
    this.dateError = page.getByTestId('date-error');
  }

  async goto() {
    await this.page.goto('/');
    // Airports load asynchronously; wait until the destination list is populated.
    await expect(this.destination.locator('option')).not.toHaveCount(0);
  }

  async search({ origin = 'DXB', destination, date, passengers = 1 }: SearchCriteria) {
    if ((await this.origin.inputValue()) !== origin) {
      await this.origin.selectOption(origin);
      await expect(this.destination.locator(`option[value="${destination}"]`)).toHaveCount(1);
    }
    await this.destination.selectOption(destination);
    await this.date.fill(date);
    await this.passengers.selectOption(String(passengers));
    await this.searchButton.click();
  }

  async destinationCodes(): Promise<string[]> {
    return this.destination.locator('option:not([value=""])').evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
  }
}
