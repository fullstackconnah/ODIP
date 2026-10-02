import { test, expect } from '@playwright/test';
import { SEEDED } from '../../support/env';

// Static tier canary: the built frontend (dev sign-in baked in) is served with the production
// security headers, proxies /api to the real API, and the real login page signs a user in.
test('login page signs in through the served frontend @smoke', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', m => { if (m.text().includes('Content Security Policy')) problems.push(m.text()); });
  page.on('pageerror', e => problems.push(`page error: ${e.message}`));

  const resp = await page.goto('/login');
  expect(resp?.headers()['content-security-policy'], 'CSP header served').toContain("default-src 'self'");

  await expect(page.getByText('Developer sign-in')).toBeVisible();
  await page.getByLabel('User', { exact: true }).selectOption(SEEDED.coordinator);
  await page.getByRole('button', { name: 'Sign in as selected user' }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('odip_token'))).toBeTruthy();
  expect(problems).toEqual([]);
});
