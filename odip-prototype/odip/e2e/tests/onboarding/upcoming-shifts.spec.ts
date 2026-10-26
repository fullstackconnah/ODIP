import { test, expect } from '../../support/fixtures';
import { SEEDED } from '../../support/env';
import { uniqueToken } from '../../support/data';

test.use({ role: SEEDED.superAdmin });

/** Staff, a participant and a weekly pattern, imported in turn; the shifts land as Draft in the next week and the hand-off opens that week. */
test('an Admin imports a weekly pattern of shifts, opens the first week, then undoes the import @onboarding', async ({ page }) => {
  const token = uniqueToken('UPS');
  const ndis = String(Date.now()).slice(-9);
  const email = `${token.toLowerCase()}@example.com`;
  const csv = (name: string, lines: string[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(lines.join('\r\n'), 'utf-8') });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  async function next() { await page.getByRole('button', { name: 'Next' }).click(); }

  await page.goto('/settings/import/staff');
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles(csv(`staff-${token}.csv`, ['First name,Last name,Email', `Sam,${token},${email}`]));
  await next(); await next();
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText(/^Imported 1/)).toBeVisible();

  await page.goto('/settings/import/participants');
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles(csv(`people-${token}.csv`, ['First name,Last name,NDIS number', `Ava,${token},${ndis}`]));
  await next(); await next();
  const landing = page.getByLabel(/Already receiving services/);
  if (await landing.count()) await landing.check();
  await next();
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText(/^Imported 1/)).toBeVisible();

  await page.goto('/settings/import/upcoming-shifts');
  await page.getByRole('radio', { name: /weekly pattern/i }).check();
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles(csv(`pattern-${token}.csv`, [
    'NDIS number,Weekday,Start time,End time,Staff email', `${ndis},Monday,09:00,15:00,${email}`,
  ]));
  await next(); await next();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await next();
  await page.getByRole('button', { name: /^Import \d+ shifts?/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();

  await page.getByRole('link', { name: 'Open the first week' }).click();
  await expect(page).toHaveURL(/\/rostering\?date=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole('button', { name: /Publish week/ })).toBeVisible();

  await page.goto('/settings?tab=import');
  await page.getByRole('row').filter({ hasText: `pattern-${token}.csv` }).getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo import' }).click();
  await expect(page.getByText(/Import undone|Import partly undone/)).toBeVisible();
});
