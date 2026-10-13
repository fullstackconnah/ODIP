import { test, expect } from '../../support/fixtures';
import { SEEDED } from '../../support/env';
import { uniqueToken } from '../../support/data';

test.use({ role: SEEDED.superAdmin });

test('an Admin imports participants from a file, finds them listed, then undoes the import @imports', async ({ page }, testInfo) => {
  const token = uniqueToken('IMP');
  const fileName = `people-${token}.csv`;
  const shot = async (name: string) => {
    await page.screenshot({ path: testInfo.outputPath(`${name}-1440.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath(`${name}-390.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
  };

  // The phone shots resize a desktop page: without motion the sidebar is already off-screen when the 390 px shot is taken.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings?tab=import');
  await expect(page.getByRole('tab', { name: 'Import data', selected: true })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download template' }).first().click()]);
  expect(download.suggestedFilename()).toBe('odip-participants-template.xlsx');
  await shot('import-tab');

  await page.getByRole('link', { name: 'Import participants' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Import participants' })).toBeVisible();
  const csv = [
    'First name,Last name,Date of birth,NDIS number,Contact 1 name,Contact 1 relationship',
    `Ava,${token}A,03/04/1990,,Ben ${token},Next of kin`,
    `Cal,${token}B,1991-05-06,,,`,
    `Dee,,1991-05-06,,,`,
  ].join('\r\n');
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
  await shot('wizard-upload');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Match columns' })).toBeVisible();
  await shot('wizard-match');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: `${token}A` })).toContainText('Ready');
  await expect(page.getByRole('row').filter({ hasText: 'Dee' })).toContainText('Last name is required.');
  await page.getByLabel(/Already receiving services/).check();
  await shot('wizard-preview');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Import 2 participants' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Imported 2 participants')).toBeVisible();
  await shot('wizard-result');

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
});
