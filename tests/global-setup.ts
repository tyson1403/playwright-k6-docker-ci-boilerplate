import { request, type FullConfig } from '@playwright/test';

/** Puts the app into a known state once per run. Tests then create their own data. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const api = await request.newContext({ baseURL });
  const reset = await api.post('/api/test/reset');
  if (!reset.ok()) {
    throw new Error(`Could not reset test data at ${baseURL} (${reset.status()}). Is ENABLE_TEST_API on?`);
  }
  await api.dispose();
}
