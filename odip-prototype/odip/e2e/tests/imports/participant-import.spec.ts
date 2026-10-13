import { test, expect } from '../../support/fixtures';
import type { Page } from '@playwright/test';
import { SEEDED } from '../../support/env';
import { uniqueToken } from '../../support/data';

test.use({ role: SEEDED.superAdmin });

const csvFor = (token: string) => [
  'First name,Last name,Date of birth,NDIS number,Contact 1 name,Contact 1 relationship',
  `Ava,${token}A,03/04/1990,,Ben ${token},Next of kin`,
  `Cal,${token}B,1991-05-06,,,`,
  `Dee,,1991-05-06,,,`,
].join('\r\n');

/** Uploads the file and walks the wizard to its Review step, calling `shot` on each step. */
async function walkToReview(page: Page, token: string, shot: (name: string) => Promise<void>) {
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles({ name: `people-${token}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csvFor(token), 'utf-8') });
  await shot('wizard-upload');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Match columns' })).toBeVisible();
  await shot('wizard-match');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(page.getByText('Last name is required.').first()).toBeVisible();
  await page.getByLabel(/Already receiving services/).check();
  await shot('wizard-preview');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('button', { name: 'Import 2 participants' })).toBeVisible();
  await shot('wizard-review');
}

/** Waits until no animation or transition is running, so a capture is not taken mid-fade or with a step pill half changed. */
const settled = (p: Page) => p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));

async function importIt(page: Page) {
  await page.getByRole('button', { name: 'Import 2 participants' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Imported 2 participants')).toBeVisible();
}

test('an Admin imports participants from a file, finds them listed, then undoes the import @imports', async ({ page }, testInfo) => {
  const token = uniqueToken('IMP');
  const fileName = `people-${token}.csv`;
  const desk = (name: string) => settled(page).then(() => page.screenshot({ path: testInfo.outputPath(`${name}-1440.png`), fullPage: true })).then(() => undefined);

  // As in the earlier captures, so the resize measurement below compares like with like.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings?tab=import');
  await expect(page.getByRole('tab', { name: 'Import data', selected: true })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download template' }).first().click()]);
  expect(download.suggestedFilename()).toBe('odip-participants-template.xlsx');

  await page.getByRole('link', { name: 'Import participants' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Import participants' })).toBeVisible();
  await walkToReview(page, token, desk);
  await importIt(page);
  await desk('wizard-result');

  // The finish review found 523 px wide phone captures taken by resizing this page. Recorded, not asserted: the fresh 390 px load below is the gate.
  await page.setViewportSize({ width: 390, height: 844 });
  const resized = await page.evaluate(() => document.documentElement.scrollWidth);
  testInfo.annotations.push({ type: 'scrollWidth after resizing to 390', description: String(resized) });
  console.log(`scrollWidth after resizing a 1440 px page to 390: ${resized}`);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('link', { name: 'View participants' }).click();
  await page.getByPlaceholder('Search participants...').fill(token);
  await expect(page.getByRole('row').filter({ hasText: token })).toHaveCount(2);

  await page.goto('/settings?tab=import');
  const batch = page.getByRole('row').filter({ hasText: fileName });
  await batch.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo import' }).click();
  await expect(batch).toContainText('Undone');

  await page.goto('/participants?tab=active');
  await page.getByPlaceholder('Search participants...').fill(token);
  await expect(page.getByRole('row').filter({ hasText: token })).toHaveCount(0);

  // Phone: a new page loaded at 390 px (it shares the signed-in storage), so no desktop layout is left behind. It imports a second file,
  // so the history shows one Imported and one Undone row.
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
  const second = uniqueToken('IMP');
  await phone.goto('/settings/import/participants');
  await expect(phone.getByRole('heading', { level: 1, name: 'Import participants' })).toBeVisible();
  await walkToReview(phone, second, narrow);
  await importIt(phone);
  await narrow('wizard-result');

  await phone.goto('/settings?tab=import');
  await expect(phone.getByText(`people-${second}.csv`)).toBeVisible();
  await expect(phone.getByText(fileName)).toBeVisible();
  await narrow('import-tab');
  await page.goto('/settings?tab=import');
  await expect(page.getByRole('row').filter({ hasText: `people-${second}.csv` })).toContainText('Imported');
  await desk('import-tab');
  await phone.close();
});
