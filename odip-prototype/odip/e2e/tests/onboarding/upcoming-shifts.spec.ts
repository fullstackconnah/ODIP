import { test, expect, call } from '../../support/fixtures';
import { SEEDED } from '../../support/env';
import { uniqueToken } from '../../support/data';
import { addDays, mondayOf, sydneyToday } from '../../support/dates';

test.use({ role: SEEDED.superAdmin });

type BoardShift = { status: string; staffName: string | null };

/**
 * Staff, a participant and a weekly pattern, imported in turn; the shifts land as Draft and the hand-off opens that week.
 * The import starts its week for good (Undo removes the shifts, never the started week), so it runs 1 week from the Monday three weeks ahead:
 * roster-agreed and roster-drag-drop use week 1 ahead, pattern-revision starts weeks 1 and 2 ahead, and roster-start-week needs week 12 unstarted.
 */
test('an Admin imports a weekly pattern of shifts, opens the first week, then undoes the import @onboarding', async ({ page, session }) => {
  const token = uniqueToken('UPS');
  const ndis = String(Date.now()).slice(-9);
  const email = `${token.toLowerCase()}@example.com`;
  const firstWeek = addDays(mondayOf(sydneyToday()), 21);
  const csv = (name: string, lines: string[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(lines.join('\r\n'), 'utf-8') });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  async function next() { await page.getByRole('button', { name: 'Next' }).click(); }
  async function confirmImport() {
    await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  }

  await page.goto('/settings/import/staff');
  await expect(page.getByRole('heading', { level: 1, name: 'Import staff' })).toBeVisible();
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles(csv(`staff-${token}.csv`, ['First name,Last name,Email', `Sam,${token},${email}`]));
  await next();
  await expect(page.getByRole('heading', { name: 'Match columns' })).toBeVisible();
  await next();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await next();
  await page.getByRole('button', { name: 'Import 1 staff member' }).click();
  await confirmImport();
  await expect(page.getByText('Imported 1 staff member')).toBeVisible();

  await page.goto('/settings/import/participants');
  await expect(page.getByRole('heading', { level: 1, name: /^Import participants/ })).toBeVisible();
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles(csv(`people-${token}.csv`, ['First name,Last name,NDIS number', `Ava,${token},${ndis}`]));
  await next();
  await expect(page.getByRole('heading', { name: 'Match columns' })).toBeVisible();
  await next();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  const landing = page.getByLabel(/Already receiving services/);
  if (await landing.count()) await landing.check();
  await next();
  await page.getByRole('button', { name: /^Import 1 participant/ }).click();
  await confirmImport();
  await expect(page.getByText(/^Imported 1 participant/)).toBeVisible();

  // Monday filled by the imported staff member, Tuesday with nobody named, then Monday again.
  await page.goto('/settings/import/upcoming-shifts');
  await page.getByRole('radio', { name: /weekly pattern/i }).check();
  await page.getByLabel('Starts from').fill(firstWeek);
  await page.getByLabel('For', { exact: true }).click();
  await page.getByRole('option', { name: '1 week', exact: true }).click();
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles(csv(`pattern-${token}.csv`, [
    'NDIS number,Weekday,Start time,End time,Staff email,Internal ref',
    `${ndis},Monday,09:00,15:00,${email},x`,
    `${ndis},Tuesday,09:00,12:00,,x`,
    `${ndis},Monday,09:00,15:00,${email},x`,
  ]));
  await next();
  await expect(page.getByRole('heading', { name: 'Match columns' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Internal ref' })).toHaveText(/Don't import/);
  await next();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(page.getByText('Repeats row 2.')).toBeVisible();
  await expect(page.getByText('1 shift has no staff yet and imports unfilled.')).toBeVisible();
  await next();
  await expect(page.getByText(/Skipped, already on the roster or repeated in the file: 1\./)).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 shifts' }).click();
  await confirmImport();
  await expect(page.getByText('Imported 2 shifts')).toBeVisible();
  await expect(page.getByText(/1 row skipped, 0 rows couldn't be imported\./)).toBeVisible();

  await page.getByRole('link', { name: 'Open the first week' }).click();
  await expect(page).toHaveURL(`/rostering?date=${firstWeek}`);
  await expect(page.getByRole('button', { name: /Publish week/ })).toBeVisible();
  await expect(page.getByRole('region', { name: "This week hasn't been started" })).toHaveCount(0);
  const board = await call(session, 'GET', `/rostering/board?weekStart=${firstWeek}&groupBy=participant`);
  const shifts: BoardShift[] = board.data.participantRows.flatMap((r: { shifts: BoardShift[] }) => r.shifts);
  const named = shifts.filter(s => s.staffName?.includes(token));
  expect(named.map(s => s.status)).toEqual(['Draft']);

  await page.goto('/settings?tab=import');
  await page.getByRole('row').filter({ hasText: `pattern-${token}.csv` }).getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo import' }).click();
  await expect(page.getByRole('row').filter({ hasText: `pattern-${token}.csv` })).toContainText('Undone');
  const after = await call(session, 'GET', `/rostering/board?weekStart=${firstWeek}&groupBy=participant`);
  expect(after.data.participantRows.flatMap((r: { shifts: BoardShift[] }) => r.shifts).filter((s: BoardShift) => s.staffName?.includes(token))).toEqual([]);
});
