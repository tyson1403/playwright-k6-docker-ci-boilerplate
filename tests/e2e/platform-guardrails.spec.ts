// Shows the guardrails inherited from playwright-automation-platform are active in this project.
import { test, expect } from '../fixtures';

test.describe('Platform guardrails', () => {
  test('an uncaught JavaScript error on the page fails the test', async ({ page }) => {
    // Expected to fail: the platform's automatic `pageErrors` fixture catches the
    // error after the test body finishes. If the guardrail were missing, this test
    // would pass unexpectedly and be reported as a failure.
    test.fail();
    await page.goto('/');
    await page.addScriptTag({ content: "throw new Error('simulated production bug')" });
  });

  test('pageErrors stays empty on a healthy page', async ({ home, pageErrors }) => {
    await home.open();
    expect(pageErrors).toEqual([]);
  });
});
