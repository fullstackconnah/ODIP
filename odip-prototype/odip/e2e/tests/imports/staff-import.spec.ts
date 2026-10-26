import { test, expect } from '../../support/fixtures';
import type { Page } from '@playwright/test';
import { DEMO_EMAIL_DOMAIN, SEEDED } from '../../support/env';
import { uniqueToken } from '../../support/data';

test.use({ role: SEEDED.superAdmin });

// Row 2 imports; row 3 asks for Admin, which an import can't give. Employment type is a column ODIP sees and does not hold.
const csvFor = (token: string) => [
  'First name,Last name,Email,Role,First aid,First aid expiry,Employment type',
  `Jo,${token}A,jo.${token.toLowerCase()}@${DEMO_EMAIL_DOMAIN},Support worker,yes,30/06/2027,Casual`,
  `Al,${token}B,al.${token.toLowerCase()}@${DEMO_EMAIL_DOMAIN},Admin,,,`,
].join('\r\n');

/** Waits until no animation or transition is running, so a capture is not taken mid-fade or with a step pill half changed. */
const settled = (p: Page) => p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));

/** Uploads the file and walks the staff wizard to its result, calling `shot` on each step. */
async function importStaff(page: Page, token: string, shot: (name: string) => Promise<void>) {
  await expect(page.getByRole('heading', { level: 1, name: 'Import staff' })).toBeVisible();
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles({ name: `staff-${token}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csvFor(token), 'utf-8') });
  await shot('staff-upload');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Match columns' })).toBeVisible();
  await expect(page.getByText("Won't be imported: your payroll system keeps employment details.")).toBeVisible();
  await shot('staff-match');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(page.getByText(/Admin can't be given through an import\./).first()).toBeVisible();
  await expect(page.getByText('Where do these participants go?')).toHaveCount(0);
  await shot('staff-preview');
  await page.getByRole('button', { name: 'Next' }).click();
  // Default path (plan D13): the invite checkbox is ticked, so the invites go out on their own after the import.
  await expect(page.getByRole('checkbox', { name: 'Email each new staff member a sign-in invite' })).toBeChecked();
  await expect(page.getByText(/Invites are sent from this browser straight after the import./)).toBeVisible();
  await shot('staff-review');
  await page.getByRole('button', { name: 'Import 1 staff member' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Imported 1 staff member')).toBeVisible();
  // The e2e stack has no real Firebase, so the person comes back 'not sent'; the loop itself is covered by ImportInvitesTests and ImportInvites.test.tsx.
  // Here only that the run starts by itself and ends is checked: the run's live region carries the finished line, and no press was needed.
  await expect(page.getByRole('status').filter({ hasText: /Sign-in invites: (all \d+ sent|\d+ sent, \d+ not sent)/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Send sign-in invites (1)' })).toHaveCount(0);
  await shot('staff-result');
}

async function undo(page: Page, fileName: string) {
  await page.goto('/settings?tab=import');
  const batch = page.getByRole('row').filter({ hasText: fileName });
  await batch.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo import' }).click();
  await expect(batch).toContainText('Undone');
}

test('an Admin imports staff, sees them on the Staff page and the invite button, then undoes the import @imports', async ({ page }, testInfo) => {
  const token = uniqueToken('IMS');
  const fileName = `staff-${token}.csv`;
  const desk = (name: string) => settled(page).then(() => page.screenshot({ path: testInfo.outputPath(`${name}-1440.png`), fullPage: true })).then(() => undefined);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/staff');
  await page.getByRole('link', { name: 'Import', exact: true }).click();
  await importStaff(page, token, desk);

  await page.getByRole('link', { name: 'View staff' }).click();
  await page.getByPlaceholder('Search staff...').fill(token);
  await expect(page.getByRole('row').filter({ hasText: `${token}A` })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: `${token}B` })).toHaveCount(0);

  await page.goto('/settings?tab=import');
  await expect(page.getByRole('row').filter({ hasText: fileName }).getByRole('button', { name: 'Send sign-in invites (1)' })).toBeVisible();
  await desk('staff-import-tab');

  // Phone: a new page loaded at 390 px (it shares the signed-in storage), so no desktop layout is left behind.
  const phone = await page.context().newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  const narrow = async (name: string) => {
    await settled(phone);
    const wide = await phone.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(e => e.getBoundingClientRect().right > 391).slice(0, 5)
      .map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 80)} right=${Math.round(e.getBoundingClientRect().right)}`));
    expect(await phone.evaluate(() => document.documentElement.scrollWidth), `${name} is wider than 390 px: ${wide.join(' | ')}`).toBeLessThanOrEqual(390);
    await phone.screenshot({ path: testInfo.outputPath(`${name}-390.png`), fullPage: true });
  };
  const second = uniqueToken('IMS');
  await phone.goto('/staff');
  await narrow('staff-page');
  await phone.goto('/settings/import/staff');
  await importStaff(phone, second, narrow);
  await phone.goto('/settings?tab=import');
  await expect(phone.getByText(`staff-${second}.csv`)).toBeVisible();
  await narrow('staff-import-tab');
  await phone.close();

  // Undo both, so no imported staff stay behind for other specs; undo deletes the accounts.
  await undo(page, fileName);
  await undo(page, `staff-${second}.csv`);
  await page.goto('/staff');
  for (const t of [token, second]) {
    await page.getByPlaceholder('Search staff...').fill(t);
    await expect(page.getByRole('row').filter({ hasText: t })).toHaveCount(0);
  }
});
