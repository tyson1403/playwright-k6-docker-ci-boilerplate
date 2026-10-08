import type { Locator, Page } from '@playwright/test';
import { BasePage } from '@tyson1403/playwright-automation-platform';

export class LoginPage extends BasePage {
  readonly path = '/login';
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly alert: Locator;

  constructor(page: Page) {
    super(page);
    this.email = page.getByLabel('Email');
    this.password = page.getByLabel('Password');
    this.submit = page.getByRole('button', { name: 'Log in' });
    this.alert = page.getByTestId('login-alert');
  }

  async login(email: string, password: string) {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }
}
