import { test, expect } from '../../support/fixtures';
import { SEEDED } from '../../support/env';

// Harold Whitby is the Demo seed's archived participant with no links (DbSeeder, id d2000000-...-0099), archived 8 years ago, so he is due on a fresh
// database. No other spec uses him. The purge is permanent and the specs share one database, so only the last Admin test purges him, and the
// Admin tests run in order in one worker.
const PERSON = 'Harold Whitby';
const LAST_NAME = 'Whitby';

test.describe('Admin', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ role: SEEDED.admin });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/settings?tab=retention');
    await expect(page.getByRole('heading', { level: 3, name: 'Due for purge' })).toBeVisible();
  });

  const row = (page: import('@playwright/test').Page) => page.getByRole('row', { name: new RegExp(PERSON) });

  test('Data retention lists the participant whose 7 years have run out', async ({ page }) => {
    await expect(row(page)).toBeVisible();
    await expect(row(page).getByRole('button', { name: `Download ${PERSON}'s data` })).toBeVisible();
    await expect(row(page).getByRole('button', { name: `Purge ${PERSON}'s record` })).toBeVisible();
  });

  test('Purge opens the dialog with the export prompt, and Cancel leaves the record alone', async ({ page }) => {
    await row(page).getByRole('button', { name: `Purge ${PERSON}'s record` }).click();
    const dialog = page.getByRole('alertdialog', { name: `Purge ${PERSON}'s record?` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Download their data first')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download their data' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(page)).toBeVisible();
  });

  test('a wrong last name or a missing reason keeps Purge record disabled and says why', async ({ page }) => {
    await row(page).getByRole('button', { name: `Purge ${PERSON}'s record` }).click();
    const dialog = page.getByRole('alertdialog');
    const confirm = dialog.getByRole('button', { name: 'Purge record' });
    const name = dialog.getByLabel(`Type their last name, ${LAST_NAME}, to confirm`);
    const reason = dialog.getByLabel('Reason');
    await expect(confirm).toBeDisabled();

    await name.fill('Smith');
    await reason.fill('Seven years have passed.');
    await name.blur();
    await expect(dialog.getByText("The last name doesn't match.")).toBeVisible();
    await expect(confirm).toBeDisabled();

    await name.fill(LAST_NAME);
    await reason.fill('');
    await reason.blur();
    await expect(dialog.getByText('Give a reason for the purge.')).toBeVisible();
    await expect(confirm).toBeDisabled();
  });

  test('the right name and a reason purge the record and the row leaves the list', async ({ page }) => {
    await row(page).getByRole('button', { name: `Purge ${PERSON}'s record` }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel(`Type their last name, ${LAST_NAME}, to confirm`).fill(LAST_NAME.toLowerCase()); // the server's rule: case-insensitive
    await dialog.getByLabel('Reason').fill('E2E: retention period ended.');
    await dialog.getByRole('button', { name: 'Purge record' }).click();

    await expect(page.getByText('Record purged', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`${PERSON}'s record and`)).toBeVisible();
    await expect(row(page)).toHaveCount(0);

    await page.reload(); // the server agrees: he does not come back
    await expect(page.getByRole('heading', { level: 3, name: 'Due for purge' })).toBeVisible();
    await expect(row(page)).toHaveCount(0);
  });
});

test.describe('Coordinator', () => {
  test.use({ role: SEEDED.coordinator });

  // settingsSections shows the tab to an Admin only, so ?tab=retention falls back to Profile: there is no no-access page to land on.
  test('has no Data retention tab, and ?tab=retention opens Profile instead', async ({ page }) => {
    await page.goto('/settings?tab=retention');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Due for purge' })).toHaveCount(0);
    await expect(page.getByText('Data retention')).toHaveCount(0);
  });
});
