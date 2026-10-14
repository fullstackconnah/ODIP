import { test, expect, call } from '../../support/fixtures';
import { expectStatus, type Session } from '../../support/api';
import { makeParticipant, makeStaff, assignShift } from '../../support/data';
import { addDays, nextWednesday, sydneyToday } from '../../support/dates';

// Real API + PostgreSQL: setup alone uses direct calls. Preview, revision creation and
// approval go through the real browser UI, with no intercepted/stubbed responses.
type Pattern = {
  id: string; dayOfWeek: string; startTime: string; endTime: string;
  sourceDraftId: string; effectiveFrom: string; effectiveTo?: string; defaultStaffId?: string;
};
type Shift = { shiftId: string; serviceDate: string; startTime: string; endTime: string; staffId?: string; status: string };
const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
const get = async (s: Session, path: string) => (await expectStatus(`GET ${path}`, 200, await call(s, 'GET', path))).data;

for (const allDays of [false, true]) {
  test(`approved pattern: ${allDays ? 'all days change' : 'one day splits'}, repricing waits for approval and replaces only eligible shifts`, async ({ page, session }) => {
    test.setTimeout(180_000);
    const participant = await makeParticipant(session);
    const staff = await makeStaff(session);
    // Two weeks, wholly inside the participant roster endpoint's 28-day window.
    const start = nextWednesday(sydneyToday());
    const end = addDays(start, 8);
    const base = `/participants/${participant.id}/service-agreement-drafts`;
    const patterns = async (): Promise<Pattern[]> => get(session, `/rostering/patterns?participantId=${participant.id}`);
    const shifts = async (): Promise<Shift[]> => (await get(session, `/participants/${participant.id}/rostering`)).upcomingShifts;
    const v1 = (await expectStatus('create priced agreement', 200, await call(session, 'POST', base, {
      planStartDate: start, planEndDate: end, agreementStartDate: start, agreementEndDate: end,
      state: 'NSW', serviceTypes: ['CommunityAccess'], baseVersion: 0,
      blocks: [{
        block: {
          id: 'community', supportType: 'CommunityAccess', intensity: 'Standard',
          days: ['Wednesday', 'Thursday'], start: '09:00:00', end: '13:00:00',
          workers: 1, participantsPresent: 1, headcountChanges: [], setting: 'Community',
          location: { state: 'NSW', zone: 'National' }, workerMaySleep: false,
          sleepoverActiveHours: 0, onPublicHoliday: 'Charge',
        },
        requirements: { workerGender: 'NoPreference', driver: false, skills: [] },
      }],
    }))).data;
    expect(v1.pricing.needsReview, 'the seed is genuinely priced and approvable').toBe(false);
    await expectStatus('approve initial agreement', 200, await call(session, 'POST', `${base}/${v1.id}/approve`, { acknowledgeOverlaps: false }));
    const originalPatterns = await patterns();
    expect(originalPatterns).toHaveLength(2);
    const originalShifts = await shifts();
    expect(originalShifts).toHaveLength(4);
    const assigned = originalShifts.find(s => s.serviceDate === start)!;
    expect(assigned).toBeTruthy();
    await assignShift(session, assigned.shiftId, staff.id);
    const before = await shifts();
    const source = originalPatterns.find(p => p.dayOfWeek === 'Wednesday')!;

    await page.goto('/rostering/patterns');
    const edit = page.getByRole('button', { name: new RegExp(`^Edit Pw ${participant.token}'s Wednesday `) });
    await edit.click();
    const panel = page.getByRole('dialog', { name: 'Edit pattern', exact: true });
    await expect(panel.getByText('From agreement v1.', { exact: true })).toBeVisible();
    await panel.getByLabel('End time', { exact: false }).fill('14:00');
    await panel.getByLabel('Change starts', { exact: false }).fill(addDays(sydneyToday(), -1));
    await panel.getByRole('button', { name: 'Check the change', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('A change cannot start before');
    await expect(panel.getByLabel('End time', { exact: false })).toHaveValue('14:00');
    expect(await get(session, base)).toHaveLength(1);
    await panel.getByLabel('Change starts', { exact: false }).fill(start);
    if (allDays) await panel.getByRole('checkbox', { name: /Change every day/ }).check();

    const changePath = `/service-agreement-drafts/${v1.id}/pattern-change`;
    const previewResponse = page.waitForResponse(r => r.url().endsWith(changePath) && r.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Check the change', exact: true }).click();
    const previewHttp = await previewResponse;
    expect(previewHttp.status()).toBe(200);
    expect(previewHttp.request().postDataJSON()).toEqual({
      patternId: source.id, dayOfWeek: 'Wednesday', startTime: '09:00', endTime: '14:00',
      endsNextDay: false, ratio: 'OneToOne', nightType: 'None', allDays, fromDate: start, preview: true,
    });
    const preview = (await previewHttp.json()).data;
    expect(preview.oldTotal).toBeGreaterThan(0);
    expect(preview.newTotal).toBeGreaterThan(preview.oldTotal);
    expect(preview.difference).toBeCloseTo(preview.newTotal - preview.oldTotal, 2);
    expect(preview.needsReview).toBe(false);
    await expect(panel.getByText(/Price from/)).toContainText(`${money(preview.oldTotal)} as it is at today's prices, ${money(preview.newTotal)} with the change (+${money(preview.difference)})`);
    expect(await get(session, base), 'preview does not create a revision').toHaveLength(1);
    expect(await patterns()).toEqual(originalPatterns);
    expect(await shifts()).toEqual(before);

    // Editing invalidates the checked quote. Cancelling then reopening loses only unsaved
    // edits, not the live approved pattern or its roster.
    await panel.getByLabel('End time', { exact: false }).fill('15:00');
    await expect(panel.getByRole('button', { name: 'Check the change', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Create revision v2', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel).toBeHidden();
    expect(await get(session, base)).toHaveLength(1);
    await edit.click();
    await expect(panel.getByLabel('End time', { exact: false })).toHaveValue('13:00');
    await panel.getByLabel('End time', { exact: false }).fill('14:00');
    await panel.getByLabel('Change starts', { exact: false }).fill(start);
    if (allDays) await panel.getByRole('checkbox', { name: /Change every day/ }).check();
    await panel.getByRole('button', { name: 'Check the change', exact: true }).click();
    const saveResponse = page.waitForResponse(r => r.url().endsWith(changePath) && r.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Create revision v2', exact: true }).click();
    const savedHttp = await saveResponse;
    expect(savedHttp.status()).toBe(200);
    expect(savedHttp.request().postDataJSON()).toEqual({ ...previewHttp.request().postDataJSON(), preview: false });
    const saved = (await savedHttp.json()).data;
    expect(saved).toMatchObject({ ...preview, draftId: expect.any(String) });
    await expect(panel.getByText('Revision v2 saved', { exact: true })).toBeVisible();
    expect(await patterns(), 'saving must not change approved patterns').toEqual(originalPatterns);
    expect(await shifts(), 'saving must not replace roster shifts before approval').toEqual(before);
    const revisions = await get(session, base);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({ id: saved.draftId, version: 2, total: preview.newTotal });
    expect(revisions[0].approval).toBeFalsy();
    expect(revisions[0].blocks).toHaveLength(allDays ? 1 : 2);

    await panel.getByRole('link', { name: 'Open the revision', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/participants/${participant.id}/agreement-draft$`));
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Mark approved for rostering', exact: true }).click();
    const approval = page.getByRole('dialog', { name: 'Approve this agreement for rostering?', exact: true });
    const removed = allDays ? 3 : 1;
    const carried = allDays ? 0 : 2;
    await expect(approval).toContainText(`Removes ${removed} unfilled shift`);
    if (carried) await expect(approval).toContainText('Carries over 2 shifts');
    await expect(approval.getByRole('heading', { name: '1 shift of the agreement it replaces stays on the roster' })).toBeVisible();
    // Opening and cancelling the approval preview is also strictly non-mutating.
    await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await shifts()).toEqual(before);
    await page.getByRole('button', { name: 'Mark approved for rostering', exact: true }).click();
    const approveResponse = page.waitForResponse(r => r.url().endsWith(`/${saved.draftId}/approve`) && r.request().method() === 'POST');
    await approval.getByRole('button', { name: 'Approve', exact: true }).click();
    const approvedHttp = await approveResponse;
    expect(approvedHttp.status()).toBe(200);
    expect(approvedHttp.request().postDataJSON()).toEqual({ acknowledgeOverlaps: false });
    const result = (await approvedHttp.json()).data;
    expect(result.oldShiftsRemaining).toMatchObject({ assigned: 1, open: 0, removed, carried });
    await expect(approval).toBeHidden();
    await expect(page.getByText('Approved for rostering', { exact: true })).toBeVisible();

    const afterPatterns = await patterns();
    for (const old of afterPatterns.filter(p => p.sourceDraftId === v1.id)) {
      expect(old.effectiveTo).toBe(addDays(start, -1));
    }
    const newPatterns = afterPatterns.filter(p => p.sourceDraftId === saved.draftId);
    expect(newPatterns).toHaveLength(2);
    for (const p of newPatterns) {
      expect(p.effectiveFrom).toBe(start);
      expect(p.endTime).toBe(allDays || p.dayOfWeek === 'Wednesday' ? '14:00:00' : '13:00:00');
    }
    const after = await shifts();
    // Assigned old work is retained verbatim; unfilled changed work is replaced, and
    // unchanged Thursday work retains its identity. Assertions are by ID, not just count.
    expect(after.find(s => s.shiftId === assigned.shiftId)).toEqual(before.find(s => s.shiftId === assigned.shiftId));
    for (const old of before.filter(s => s.shiftId !== assigned.shiftId)) {
      const isThursday = old.serviceDate === addDays(start, 1) || old.serviceDate === addDays(start, 8);
      if (!allDays && isThursday) expect(after.find(s => s.shiftId === old.shiftId)).toEqual(old);
      else expect(after.some(s => s.shiftId === old.shiftId)).toBe(false);
    }
    const fresh = after.filter(s => !before.some(old => old.shiftId === s.shiftId));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every(s => s.endTime === '14:00:00' && !s.staffId && s.status === 'Draft')).toBe(true);
    // Repeated approval is idempotent at the real persistence boundary.
    await expectStatus('repeat approval', 200, await call(session, 'POST', `${base}/${saved.draftId}/approve`, { acknowledgeOverlaps: false }));
    expect(await shifts()).toEqual(after);
    expect(await patterns()).toEqual(afterPatterns);
  });
}
