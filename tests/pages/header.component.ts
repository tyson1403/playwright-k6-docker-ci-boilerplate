import type { Locator, Page } from '@playwright/test';

export class Header {
  readonly greeting: Locator;
  readonly loginLink: Locator;
  readonly registerLink: Locator;
  readonly tripsLink: Locator;
  readonly logoutButton: Locator;

  constructor(private readonly page: Page) {
    this.greeting = page.getByTestId('user-greeting');
    this.loginLink = page.getByTestId('nav-login');
    this.registerLink = page.getByTestId('nav-register');
    this.tripsLink = page.getByTestId('nav-trips');
    this.logoutButton = page.getByTestId('logout-button');
  }

  async logout() {
    await this.logoutButton.click();
    await this.page.waitForURL('/');
  }
}
