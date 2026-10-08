import { devices } from '@playwright/test';
import { createConfig } from '@tyson1403/playwright-automation-platform';

// Built on the shared playwright-automation-platform: it owns the Playwright
// version and the defaults (retries and forbidOnly in CI, list + HTML reporters).
// This file only declares what is specific to SkyLane Air.

const isCI = !!process.env.CI;
// When BASE_URL is set (Docker / CI against a deployed app) we test that app;
// otherwise Playwright starts the app locally.
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

export default createConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: true,
  workers: isCI ? 4 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // Adds JUnit and GitHub annotations in CI on top of the platform's reporters.
  reporter: isCI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  // Merged with the platform's `use` defaults.
  use: {
    baseURL,
    testIdAttribute: 'data-testid',
    // The platform traces on first retry; locally there are no retries, so keep failures debuggable.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pin locale/timezone so formatted dates are identical on every machine.
    locale: 'en-US',
    timezoneId: 'Asia/Dubai',
  },
  // Replaces the platform's browser list: SkyLane splits API and UI suites into separate projects.
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
    },
    {
      name: 'chromium',
      testMatch: /(e2e|hybrid)\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      testMatch: /(e2e|hybrid)\/.*\.spec\.ts/,
      grep: /@smoke/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm --prefix app start',
        url: `${baseURL}/api/health`,
        reuseExistingServer: !isCI,
        timeout: 30_000,
      },
});
