import { test, expect } from '../../support/fixtures';
import { ensureProviderSettings, makeParticipant, makeShift, makeStaff, publishShift, startWeek } from '../../support/data';
import { addDays, mondayOf, nextWednesday } from '../../support/dates';

// Roster week per person (PLAN 2026-10-28 §4.4), on the real API and PostgreSQL: a name on the board opens that person's week on their
// profile, a name on a chip there opens the other person's week, and a shift opens its editor in place on the grid.
test('a name on the board opens their week, and a shift there opens its editor in place', async ({ page, session }, testInfo) => {
  await ensureProviderSettings(session);
  const participant = await makeParticipant(session);
  const staff = await makeStaff(session);
  // A week no other spec uses (roster-start-week takes +77 days): the board's leave guard counts every participant's drafts in view, and the full suite leaves some in nextWednesday()'s week.
  const wednesday = addDays(nextWednesday(), 154 + 7 * testInfo.retry);
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

  // 3. A block on the grid opens the shift's editor in place; the URL stays on the Week tab.
  // Top-left corner: the block's centre is the other person's name link, which navigates on its own.
  const block = page.locator('[data-shift-open="' + shift.id + '"]');
  await block.click({ position: { x: 6, y: 6 } });
  const editor = page.getByRole('dialog', { name: 'Shift details' });
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/staff/${staff.id}\\?tab=week&week=${mon}$`));

  // 4. Escape closes it and focus returns to the block.
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(block).toBeFocused();

  // 5. An empty slot starts a new shift at that time (10:30 on the Thursday, one hour long).
  await page.locator('[data-day="' + addDays(mon, 3) + '"] [data-minute="630"]').click();
  const creator = page.getByRole('dialog', { name: 'New shift' });
  await expect(creator).toBeVisible();
  await expect(creator.getByLabel(/^Start time/)).toHaveValue('10:30');
  await expect(creator.getByLabel(/^End time/)).toHaveValue('11:30');
  await page.keyboard.press('Escape');
  await expect(creator).toHaveCount(0);
});
