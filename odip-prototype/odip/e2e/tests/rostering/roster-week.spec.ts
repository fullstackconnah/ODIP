import { test, expect } from '../../support/fixtures';
import { ensureProviderSettings, makeParticipant, makeShift, makeStaff, publishShift, startWeek } from '../../support/data';
import { mondayOf, nextWednesday } from '../../support/dates';

// Roster week per person (PLAN 2026-10-28 §4.4), on the real API and PostgreSQL: a name on the board opens that person's week on their
// profile, a name on a chip there opens the other person's week, and a shift opens its editor back on the board; Back returns to the week.
test('a name on the board opens their week, and a shift there opens its editor on the board', async ({ page, session }) => {
  await ensureProviderSettings(session);
  const participant = await makeParticipant(session);
  const staff = await makeStaff(session);
  const wednesday = nextWednesday();
  const mon = mondayOf(wednesday);
  const shift = await makeShift(session, participant.id, wednesday);
  // Published, so the board's leave guard (drafts not visible to staff yet) does not ask when the name is clicked.
  await publishShift(session, shift.id, participant.id, wednesday, staff.id);
  await startWeek(session, wednesday);

  // 1. The participant's row name on the board opens their week, on People & roster's Week section.
  await page.goto(`/rostering?date=${wednesday}&participant=${participant.id}`);
  await page.getByRole('link', { name: `Pw ${participant.token}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/participants/${participant.id}\\?tab=people&section=week&week=${mon}$`));
  await expect(page.getByRole('tab', { name: /^Week/ })).toHaveAttribute('aria-selected', 'true');
  const worker = page.getByRole('link', { name: `Wk ${staff.token}`, exact: true });
  await expect(worker).toBeVisible();

  // 2. The worker's name on the chip opens the worker's week, with the participant on the chip.
  await worker.click();
  await expect(page).toHaveURL(new RegExp(`/staff/${staff.id}\\?tab=week&week=${mon}$`));
  await expect(page.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: `Pw ${participant.token}`, exact: true })).toBeVisible();

  // 3. The chip opens the shift's editor on the board; the board drops shift= from the URL.
  // Top-left corner: the chip's centre is the other person's name link, which navigates on its own.
  await page.locator(`[data-shift-open="${shift.id}"]`).click({ position: { x: 6, y: 6 } });
  const editor = page.getByRole('dialog', { name: 'Shift details' });
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/rostering\\?date=${mon}$`));

  // 4. Close it, and Back returns to the worker's week.
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/staff/${staff.id}\\?tab=week&week=${mon}$`));
});
