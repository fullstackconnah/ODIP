import { expect } from '@playwright/test';
import { call, test } from '../../support/fixtures';
import { expectStatus, login, type ApiResult, type Session } from '../../support/api';
import { ensureProviderSettings, makeShift, uniqueToken } from '../../support/data';
import { addDays, sydneyToday } from '../../support/dates';
import { SEEDED } from '../../support/env';

// The budget graph on the Funding tab, against the real API and PostgreSQL in real Chromium, set up like ledger-booking-replacement.spec.ts.
// A funded participant with one Core pool, two shifts whose day has passed and one rostered ahead:
//   BudgetLedgerService     a shift whose day has passed and that was never completed is PENDING (PastShift), so it counts as used;
//                           a shift from today on is BOOKED AHEAD (FutureShift). Both are priced the way ODIP will claim them, so the
//                           participant carries an NDIS number and the plan sits in the seeded catalogue's year.
//   BudgetSeriesService     reads the ledger's own items, so the plan scope's used and the last point's used-and-booked are the ledger's
//                           pool figures exactly (the no-disagreement rule), and the series has the ledger's roles: a SupportWorker is refused.
// shortcut: the seeded catalogue is 2026-27, so the shifts price only while today is in it; move with the seed (as saveBlocksDraft does).

async function fundedParticipant(session: Session, token: string): Promise<string> {
  const created: ApiResult = await expectStatus('POST participant', 201, await call(session, 'POST', '/participants', {
    firstName: 'Graph',
    lastName: token,
    dateOfBirth: '1990-05-14',
    email: `graph.${token.toLowerCase()}@demo.odip.com.au`,
    phone: '0400000000',
    addressStreet: '1 Ledger Street',
    addressSuburb: 'Newtown',
    addressState: 'NSW',
    addressPostcode: '2042',
    ndisNumber: `420${Math.floor(100000000 + Math.random() * 899999999)}`,
    planType: 1, // PlanManaged
    isDraft: false,
    completeIntake: true,
  }));
  const id = created.data?.id as string;
  await expectStatus('POST participant status', 200, await call(session, 'POST', `/participants/${id}/status`, { isActive: true }));
  return id;
}

async function corePlan(session: Session, participantId: string, today: string): Promise<void> {
  const planStart = addDays(today, -60);
  const planEnd = addDays(planStart, 364);
  await expectStatus('POST funding plan', 201, await call(session, 'POST', `/participants/${participantId}/funding/plans`, {
    planStart,
    planEnd,
    periodLengthMonths: 3,
    evidence: 0, // PlanCopy
    confirmedOn: today,
    confirmedByName: 'E2E Browser Acceptance',
    pools: [{ kind: 0, paceCategory: 0, managementType: 2, periods: [{ periodStart: planStart, periodEnd: planEnd, planAmount: 20000, setAside: 0 }] }],
  }));
}

test('the Funding tab draws the budget graph from the ledger\'s own figures', async ({ page, session }) => {
  await ensureProviderSettings(session);
  const today = sydneyToday();
  const participantId = await fundedParticipant(session, uniqueToken('G'));
  await corePlan(session, participantId, today);
  await makeShift(session, participantId, addDays(today, -14));
  await makeShift(session, participantId, addDays(today, -7));
  await makeShift(session, participantId, addDays(today, 7));

  // The API: the plan scope agrees with the ledger's pool, and the series keeps the ledger's roles.
  const ledger: ApiResult = await expectStatus('GET ledger', 200, await call(session, 'GET', `/participants/${participantId}/funding/ledger`));
  const pool = ledger.data.pools[0].planTotal as { used: number; forecast: number };
  const series: ApiResult = await expectStatus('GET series', 200, await call(session, 'GET', `/participants/${participantId}/funding/ledger/series`));
  expect(series.data.chart, 'the catalogue is in effect over the plan, so the chart is drawn').toBe('Ok');
  const plan = series.data.scopes[0];
  expect(plan.scopeKey).toBe('plan');
  expect(plan.summary.used, 'used is the ledger pool\'s used').toBe(pool.used);
  expect(plan.points.at(-1).usedAndBooked, 'the booked line ends on the ledger pool\'s forecast').toBe(pool.forecast);
  const worker = await login(SEEDED.supportWorker);
  await expectStatus('GET series as a SupportWorker', 403, await call(worker, 'GET', `/participants/${participantId}/funding/ledger/series`));

  // The screen.
  await page.goto(`/participants/${participantId}?tab=funding`);
  await expect(page.getByRole('heading', { name: 'How the budget is tracking' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^The whole plan: used/)).toBeVisible();
  expect(await page.locator('[data-table] tbody tr').count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-series="used"]')).toBeVisible();
});
