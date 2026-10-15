import { test, expect, call } from '../../support/fixtures';
import { expectStatus, login } from '../../support/api';
import { addDays, sydneyToday, ZONE } from '../../support/dates';
import { assignShift, makeParticipant, makeStaff, shiftBody } from '../../support/data';

// The dashboard's quick actions end to end on the real API and PostgreSQL (spec 2026-10-14, PR A): a coordinator approves a leave request and a clean
// shift completion on the dashboard row, and the server records both. The fixture signs in the seeded Coordinator. Nothing is mocked.

/** The provider's wall clock (Sydney: the e2e stack seeds no ProviderSettings) some minutes from now, as a date and an "HH:MM:00" time. */
function providerClock(minutesFromNow: number): { date: string; time: string } {
  const at = new Date(Date.now() + minutesFromNow * 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:00` };
}

test.describe('dashboard quick actions', () => {
  test('a coordinator approves a leave request on the dashboard row', async ({ page, session }) => {
    const staff = await makeStaff(session);
    // Tomorrow: the group lists pending requests soonest start first, so the soonest start keeps this one on the dashboard's first five.
    const start = addDays(sydneyToday(), 1);
    // The worker asks (POST /portal/leave is Pending); a coordinator's POST /leave on someone's behalf is approved at once (LeaveController.CreateLeave).
    expect(staff.username, 'the staff-create response names the sign-in user').toBeTruthy();
    const worker = await login(staff.username);
    const created = await expectStatus('request leave', 201, await call(worker, 'POST', '/portal/leave', {
      leaveType: 'Annual', startDate: start, endDate: addDays(start, 1), reason: `E2E ${staff.token}`,
    }));
    // The e2e database is shared by every spec (bell.spec.ts leaves a pending request, and cancels it), so check the precondition rather than hope:
    // the dashboard shows the five soonest-starting pending requests, leave and unavailability merged (useLeaveGroup).
    const pendingLeave = (await expectStatus('pending leave', 200, await call(session, 'GET', '/leave?status=Pending'))).data as any[];
    const pendingRules = (await expectStatus('pending unavailability', 200, await call(session, 'GET', '/leave/unavailability?status=Pending'))).data as any[];
    const soonest = [...pendingLeave.map((l) => ({ id: l.id, start: l.startDate as string })), ...pendingRules.map((r) => ({ id: r.id, start: r.effectiveFrom as string }))]
      .sort((a, b) => a.start.localeCompare(b.start)).map((r) => r.id);
    const leaveAt = soonest.indexOf(created.data.id);
    expect(leaveAt >= 0 && leaveAt < 5, `the request is pending row ${leaveAt + 1} by start date: the dashboard shows the first five`).toBe(true);

    await page.goto('/');
    const approve = page.getByRole('button', { name: new RegExp(`^Approve leave: Wk ${staff.token}, `) });
    await expect(approve).toBeVisible();
    await approve.click();
    await expect(approve).toHaveCount(0);

    const listed = await expectStatus('leave list', 200, await call(session, 'GET', `/leave?userId=${staff.id}`));
    expect((listed.data as any[]).find((l) => l.id === created.data.id)?.status).toBe('Approved');
  });

  test('a coordinator approves a clean shift completion on the dashboard row', async ({ page, session }) => {
    const from = providerClock(2);
    const to = providerClock(8);
    test.skip(from.date !== to.date, 'too close to midnight in Sydney for a same-day shift');
    const participant = await makeParticipant(session);
    const staff = await makeStaff(session);
    expect(staff.username, 'the staff-create response names the sign-in user').toBeTruthy();
    const body = shiftBody(participant.id, from.date, { startTime: from.time, endTime: to.time });
    const shift = await expectStatus('create shift', 200, await call(session, 'POST', '/rostering/shifts', body));
    const assigned = await assignShift(session, shift.data.id, staff.id);
    expect(assigned.data.findings ?? []).toEqual([]);
    await expectStatus('publish shift', 200, await call(session, 'PUT', `/rostering/shifts/${shift.data.id}`, { ...body, staffId: staff.id, status: 'Published' }));

    // The worker starts and finishes it (not the manual-start path, which the queue flags), with nothing to note and nothing to hand over.
    const worker = await login(staff.username);
    await expectStatus('start', 200, await call(worker, 'POST', `/portal/shifts/${shift.data.id}/start`, { geolocationDeclined: true }));
    await expectStatus('finish', 200, await call(worker, 'POST', `/portal/shifts/${shift.data.id}/finish`, {
      geolocationDeclined: true, nothingToNote: true, nothingToHandOver: true,
    }));
    const queue = await expectStatus('queue', 200, await call(session, 'GET', '/rostering/completions?status=PendingReview&page=1&pageSize=100'));
    // Only a clean row is approved in one tap. If this fails, the shift's times or the provider zone are off, not the dashboard.
    expect((queue.data.items as any[]).find((i) => i.shiftId === shift.data.id))
      .toMatchObject({ isOutlierVariance: false, dosesWithoutOutcome: 0, startWasManual: false, incidentCount: 0 });
    // The dashboard asks the same queue, in the same order (outliers first, then service date, then start), for its first five. Another spec's
    // PendingReview shift ahead of this one would push it off: check it, so a failure names the cause instead of a missing button.
    const shiftAt = (queue.data.items as any[]).findIndex((i) => i.shiftId === shift.data.id);
    expect(shiftAt >= 0 && shiftAt < 5, `the shift is row ${shiftAt + 1} of the review queue: the dashboard shows the first five`).toBe(true);

    await page.goto('/');
    const approve = page.getByRole('button', { name: new RegExp(`^Approve shift: Wk ${staff.token} with `) });
    await expect(approve).toBeVisible();
    await approve.click();
    await expect(approve).toHaveCount(0);

    const completed = await expectStatus('completed', 200, await call(session, 'GET', '/rostering/completions?status=Completed&page=1&pageSize=100'));
    expect((completed.data.items as any[]).some((i) => i.shiftId === shift.data.id)).toBe(true);
  });
});
