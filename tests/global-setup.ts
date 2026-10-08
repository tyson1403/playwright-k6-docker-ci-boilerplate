import type { FullConfig } from '@playwright/test';

/** Puts the app into a known state once per run. Tests then create their own data. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const reset = await fetch(new URL('/api/test/reset', baseURL), { method: 'POST' });
  if (!reset.ok) {
    throw new Error(`Could not reset test data at ${baseURL} (${reset.status}). Is ENABLE_TEST_API on?`);
  }
}
