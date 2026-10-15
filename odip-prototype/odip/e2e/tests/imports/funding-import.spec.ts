import { test, expect } from '../../support/fixtures';
import type { Page } from '@playwright/test';
import { SEEDED } from '../../support/env';
import { uniqueToken } from '../../support/data';
import { addDays, sydneyToday } from '../../support/dates';

test.use({ role: SEEDED.superAdmin });

/** Walks a wizard already on its Upload step to its result; a participant file lands as already receiving services. */
async function runImport(page: Page, fileName: string, lines: string[], button: string, done: string) {
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: Buffer.from(lines.join('\r\n'), 'utf-8') });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Match columns' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  const landing = page.getByLabel(/Already receiving services/);
  if (await landing.count()) await landing.check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: button }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText(done)).toBeVisible();
}

async function undo(page: Page, fileName: string) {
  await page.goto('/settings?tab=import');
  await page.getByRole('row').filter({ hasText: fileName }).getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo import' }).click();
}

test('an Admin imports funding plans for imported participants, finds the plan on the Funding tab, then undoes both in order @imports', async ({ page }) => {
  const token = uniqueToken('IMF');
  const people = `people-${token}.csv`;
  const budgets = `budgets-${token}.csv`;
  // Relative dates, so the plan stays the current one on the Funding tab whenever CI runs. The import reads yyyy-mm-dd.
  const start = addDays(sydneyToday(), -30);
  const end = addDays(start, 364);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // A real NDIS number is 9 digits (the funding import refuses anything else as one); the e2e database is fresh for each run.
  const ndis = String(Date.now()).slice(-9);
  await page.goto('/settings/import/participants');
  await runImport(page, people, ['First name,Last name,NDIS number,Plan type,Plan start,Plan end', `Ava,${token},${ndis},Plan managed,${start},${end}`],
    'Import 1 participant', 'Imported 1 participant');

  await page.goto('/settings?tab=import');
  const card = page.getByRole('region', { name: 'Funding plans' });
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Download template' }).click()]);
  expect(download.suggestedFilename()).toBe('odip-funding-plans-template.xlsx');
  await card.getByRole('link', { name: 'Import funding plans' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Import funding plans' })).toBeVisible();
  await runImport(page, budgets, [
    'NDIS number,Plan start,Plan end,Support category,Managed by,Amount',
    `${ndis},${start},${end},01,Plan managed,1000`,
    `${ndis},${start},${end},04,Plan managed,250.50`,
    `${ndis},${start},${end},15,NDIA managed,5000`,
  ], 'Import 1 funding plan', 'Imported 1 funding plan');

  await expect(page.getByRole('link', { name: 'View budgets' })).toHaveAttribute('href', '/budgets');
  await page.goto('/participants?tab=active');
  await page.getByPlaceholder('Search participants...').fill(token);
  await page.getByRole('row').filter({ hasText: token }).getByRole('cell').nth(1).click();
  await page.waitForURL(/\/participants\/[0-9a-f-]{36}/);
  await page.goto(`${new URL(page.url()).pathname}?tab=funding`);
  await expect(page.getByText('Core (flexible)').first()).toBeVisible();
  await expect(page.getByText(`Imported from ${budgets} on`, { exact: false })).toBeVisible();

  // Plans block their participants' undo, so the participants go last.
  await undo(page, people);
  await expect(page.getByText(`Ava ${token} has a funding plan`)).toBeVisible();
  await undo(page, budgets);
  await expect(page.getByRole('row').filter({ hasText: budgets })).toContainText('Undone');
  await undo(page, people);
  await expect(page.getByRole('row').filter({ hasText: people })).toContainText('Undone');

  // A phone keeps the wizard inside its width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/import/funding-plans');
  await expect(page.getByRole('heading', { level: 1, name: 'Import funding plans' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
