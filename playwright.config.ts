import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
// When BASE_URL is set (Docker / CI against a deployed app) we test that app;
// otherwise Playwright starts the app locally.
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 4 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: isCI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pin locale/timezone so formatted dates are identical on every machine.
    locale: 'en-US',
    timezoneId: 'Asia/Dubai',
  },
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
