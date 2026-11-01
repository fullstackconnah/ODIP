import { test, expect, call } from '../../support/fixtures';
import { expectStatus } from '../../support/api';
import { startWeek } from '../../support/data';
import { addDays, sydneyToday } from '../../support/dates';

// Owner decisions 2026-10-13, end to end on the real API and PostgreSQL: a participant whose intake is complete is in onboarding; the checklist
// shows what is open; "Begin services" lets them be rostered while they stay in onboarding; a shift can be made for them; "Make active" (with
// items still open, past its warning) moves them to the Active tab. Nothing is mocked. The participant is synthetic data of this spec.

const token = `${(process.pid % 4096).toString(36)}${Date.now().toString(36).slice(-5)}`;

test('a participant in onboarding begins services, is rostered, and is made active with items still open', async ({ page, session }) => {
  // 1. Intake complete: a draft with its intake completed is in onboarding. Profile details are there (names, date of birth, NDIS number).
  const created = await expectStatus('create participant with a completed intake', 201, await call(session, 'POST', '/participants', {
    firstName: 'Onb', lastName: `Journey${token}`, dateOfBirth: '1990-05-14', ndisNumber: `43${Date.now().toString().slice(-7)}`,
    isDraft: true, completeIntake: true,
  }));
  const id = created.data.id as string;
  const name = `Onb Journey${token}`;

  // 2. The checklist shows the open items.
  await page.goto(`/onboarding/${id}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const list = page.getByRole('list', { name: /of 6 done$/ });
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem').filter({ hasText: 'Service needs' })).toContainText('To do');
  await expect(list.getByRole('listitem').filter({ hasText: 'Signed agreement' })).toContainText('To do');

  // 3. Begin services, past its confirmation: they stay in onboarding, now able to receive services.
  await page.getByRole('button', { name: 'Begin services' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Begin services' }).click();
  await expect(page.getByText(/^Services started \d/)).toBeVisible();

  // 4. On the rostering board, tagged as still onboarding.
  // The current week reads as unstarted until Start rostering (2026-10-16): the grid would sit, hidden, under the Start card.
  await startWeek(session, sydneyToday());
  await page.goto('/rostering');
  const row = page.getByRole('link', { name }).locator('xpath=ancestor::div[contains(@class,"sticky")][1]');
  await expect(row).toBeVisible();
  await expect(row.getByText('Onboarding', { exact: true }).or(row.getByRole('button', { name: /onboarding is still open/ }))).toBeVisible();

  // 5. A shift can be created for them (the server's placement gate, CheckAsync, now accepts them).
  const day = addDays(sydneyToday(), 2);
  await expectStatus('create an unfilled shift', [200, 201], await call(session, 'POST', '/rostering/shifts', {
    participantId: id, staffId: null, serviceDate: day, startTime: '09:00:00', endTime: '12:00:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None',
  }));

  // 6. Make active with items still open: the warning names them, and going ahead is allowed (Warn mode).
  await page.goto(`/onboarding/${id}`);
  await page.getByRole('button', { name: 'Make active' }).click();
  const warning = page.getByRole('alertdialog');
  await expect(warning).toContainText('checklist items are still open');
  await expect(warning).toContainText('Signed agreement');
  await warning.getByRole('button', { name: 'Make active' }).click();

  // 7. On the Active tab.
  await expect(page).toHaveURL(/\/participants\?tab=active/);
  await expect(page.getByText(`${name} is now an active participant.`)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
});
