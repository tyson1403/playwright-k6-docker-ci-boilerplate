import type { Locator, Page } from '@playwright/test';
import { BasePage, expect } from '@tyson1403/playwright-automation-platform';

export class CheckinPage extends BasePage {
  readonly path = '/checkin';
  readonly pnrInput: Locator;
  readonly lastNameInput: Locator;
  readonly startButton: Locator;
  readonly alert: Locator;
  readonly seatmap: Locator;
  readonly availableSeats: Locator;
  readonly completeButton: Locator;
  readonly success: Locator;
  readonly boardingPasses: Locator;

  constructor(page: Page) {
    super(page);
    this.pnrInput = page.getByLabel('Booking reference');
    this.lastNameInput = page.getByLabel('Last name');
    this.startButton = page.getByRole('button', { name: 'Start check-in' });
    this.alert = page.getByTestId('checkin-alert');
    this.seatmap = page.getByTestId('seatmap');
    this.availableSeats = this.seatmap.locator('button.seat:not([disabled])');
    this.completeButton = page.getByRole('button', { name: 'Confirm seats and check in' });
    this.success = page.getByTestId('checkin-success');
    this.boardingPasses = page.getByTestId('boarding-pass');
  }

  async start(pnr: string, lastName: string) {
    await this.pnrInput.fill(pnr);
    await this.lastNameInput.fill(lastName);
    await this.startButton.click();
  }

  seat(label: string): Locator {
    return this.page.getByTestId(`seat-${label}`);
  }

  selectedSeat(passengerId: string): Locator {
    return this.page.getByTestId(`selected-seat-${passengerId}`);
  }

  /**
   * Picks a random free seat for each passenger in turn and returns the chosen seats.
   * Random rather than first-free so parallel tests on the same flight don't collide.
   */
  async chooseAvailableSeats(passengerCount: number): Promise<string[]> {
    await expect(this.seatmap).toBeVisible();
    const chosen: string[] = [];
    for (let i = 0; i < passengerCount; i++) {
      const seat = this.availableSeats.nth(Math.floor(Math.random() * (await this.availableSeats.count())));
      const label = (await seat.getAttribute('data-seat'))!;
      await seat.click();
      await expect(this.seat(label)).toHaveAttribute('aria-pressed', 'true');
      chosen.push(label);
    }
    return chosen;
  }
}
