import { test, expect, call } from '../../support/fixtures';
import { approveDraft, ensureProviderSettings, makeParticipant, saveBlocksDraft } from '../../support/data';
import { addDays, mondayOf, nextWednesday, sydneyToday } from '../../support/dates';

// Start rostering (spec 2026-10-16), on the real API and PostgreSQL: an approved agreement's week is dormant until Start; Start makes its shifts as drafts, the banner
// says staff can't see them, leaving the week asks first, and Publish week sends them. Its own week, past every other spec's agreement, and a week later on a retry: a retry finds it started.
type BoardShift = { status: string; fromAgreement?: boolean };

test('a week is started, guarded while its drafts are unpublished, then published', async ({ page, session }, testInfo) => {
  await ensureProviderSettings(session);
  const participant = await makeParticipant(session);
  const wednesday = addDays(nextWednesday(), 77 + 7 * testInfo.retry);
  // The agreement ends a week after the week under test, so it never runs past the helper's plan window.
  const draft = await saveBlocksDraft(session, participant.id, ['Wednesday', 'Thursday'], sydneyToday(), addDays(wednesday, 7));
  await approveDraft(session, participant.id, draft.id);
  const mine = async () => {
    const board = await call(session, 'GET', `/rostering/board?weekStart=${mondayOf(wednesday)}&groupBy=participant`);
    const row = board.data.participantRows.find((r: { participantId: string }) => r.participantId === participant.id);
    return { started: board.data.weekStarted as boolean, shifts: row.shifts as BoardShift[] };
  };
  expect(await mine()).toEqual({ started: false, shifts: [] });

  // 1. Dormant: the card over the faded, inert grid.
  await page.goto(`/rostering?date=${wednesday}&participant=${participant.id}`);
  const card = page.getByRole('region', { name: "This week hasn't been started" });
  await expect(card).toBeVisible();
  await expect(page.locator('[inert][aria-hidden="true"]')).toHaveCount(1);

  // 2. Start: the result shows, and this participant's Wednesday and Thursday are agreement drafts.
  await card.getByRole('button', { name: /^Start rostering / }).click();
  await expect(page.getByText(/^Started .+: \d+ shifts? added$/)).toBeVisible();
  await expect(card).toHaveCount(0);
  const started = await mine();
  expect(started.started).toBe(true);
  expect(started.shifts.map(s => [s.status, s.fromAgreement])).toEqual([['Draft', true], ['Draft', true]]);
  const banner = page.getByText(/^\d+ shifts? not visible to staff yet$/);
  await expect(banner).toBeVisible();

  // 3. The week guard: Next asks; Escape keeps the week.
  const heading = page.locator('#roster-week-heading');
  const week = (await heading.textContent())!;
  const ask = page.getByRole('alertdialog', { name: 'Leave without publishing?' });
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(ask).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(heading).toHaveText(week);

  // 4. The route guard: the participant's name asks in the same words; Stay keeps the board.
  await page.getByRole('link', { name: `Pw ${participant.token}`, exact: true }).click();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(/\/rostering\?/);

  // 5. Publish week: the banner goes, the toolbar says so, and Next moves without asking.
  await page.getByRole('button', { name: 'Publish week' }).click();
  await page.getByRole('alertdialog', { name: /^Publish .+\?$/ }).getByRole('button', { name: /^Publish \d+ shifts?$/ }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByText('All published')).toBeVisible();
  expect((await mine()).shifts.map(s => s.status)).toEqual(['Published', 'Published']);
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(heading).not.toHaveText(week);
  await expect(ask).toHaveCount(0);
});
