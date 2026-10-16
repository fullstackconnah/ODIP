import { Locator, Page } from '@playwright/test';
import { test, expect, call } from '../../support/fixtures';
import { approveDraft, assignShift, ensureProviderSettings, makeParticipant, makeShift, makeStaff, saveBlocksDraft, startWeek } from '../../support/data';
import { addDays, mondayOf, nextWednesday, sydneyToday } from '../../support/dates';

// Roster agreed shifts, the plus picker and ad-hoc shifts (spec 2026-10-15), on the real API and PostgreSQL. An agreement saved from blocks waits for approval (the board says so),
// is approved through the API as the agreement page's dialog does, and its Agreed Needs staff shifts are filled from the plus: a free person, then a person moved off an
// overlapping shift. Last, a person dropped on the new-shift slot of a day that already holds a shift opens the create panel, and the saved shift is Ad hoc.

type BoardShift = { id: string; serviceDate: string; staffId?: string; fromAgreement?: boolean; shiftPatternId?: string | null };

/** Lifts `from` with the mouse (dnd-kit's MouseSensor needs 4px), and only THEN measures the target: a new-shift slot exists only while a person is carried. */
async function carryOnto(page: Page, from: Locator, target: Locator) {
  const a = await from.boundingBox();
  if (!a) throw new Error('the drag source is not on screen');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 4 });
  await target.waitFor({ state: 'visible' });
  const b = await target.boundingBox();
  if (!b) throw new Error('the drop target is not on screen');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
  // dnd-kit swallows clicks on the document for 50 ms after a drop.
  await page.waitForTimeout(150);
}

test('agreed shifts wait for approval, then fill from the plus, and a person dropped beside them starts an ad-hoc shift', async ({ page, session }) => {
  await ensureProviderSettings(session);
  const participant = await makeParticipant(session);
  const other = await makeParticipant(session);
  const kim = await makeStaff(session);
  const jack = await makeStaff(session);
  const lee = await makeStaff(session);
  const wednesday = nextWednesday();
  const thursday = addDays(wednesday, 1);
  // Jack works Thursday 9am-5pm with the other participant: "On another shift at this time" for Thursday's agreed 9am-3pm.
  const jacksShift = await makeShift(session, other.id, thursday);
  await assignShift(session, jacksShift.id, jack.id);
  const draft = await saveBlocksDraft(session, participant.id, ['Wednesday', 'Thursday'], sydneyToday(), addDays(sydneyToday(), 70));
  const shiftsOf = async (participantId: string): Promise<BoardShift[]> => {
    const board = await call(session, 'GET', `/rostering/board?weekStart=${mondayOf(wednesday)}&groupBy=participant`);
    return board.data.participantRows.find((r: { participantId: string }) => r.participantId === participantId).shifts;
  };

  // 1. Not approved yet: the notice names the participant and links to the agreement; none of its shifts are on the board.
  await page.goto(`/rostering?date=${wednesday}&participant=${participant.id}`);
  const notice = page.getByText(/^Shifts from a service agreement appear here once it's approved for rostering and the week is started\./);
  await expect(notice).toContainText(`Pw ${participant.token} v1`);
  await expect(page.getByRole('link', { name: `Pw ${participant.token} v1: open the service agreement` })).toHaveAttribute('href', `/participants/${participant.id}/agreement-draft`);
  expect(await shiftsOf(participant.id)).toEqual([]);

  // 2. Approved: Wednesday and Thursday hold Agreed Needs staff shifts, and the notice has gone.
  await startWeek(session, wednesday);
  await approveDraft(session, participant.id, draft.id);
  const agreed = await shiftsOf(participant.id);
  const wedId = agreed.find(s => s.serviceDate === wednesday && s.fromAgreement)!.id;
  const thuId = agreed.find(s => s.serviceDate === thursday && s.fromAgreement)!.id;
  await page.reload();
  await expect(notice).toHaveCount(0);
  const wedChip = page.locator(`[data-shift-open="${wedId}"]`);
  const thuChip = page.locator(`[data-shift-open="${thuId}"]`);
  await expect(wedChip).toHaveAttribute('aria-label', /Needs staff/);
  await expect(wedChip).toHaveAttribute('aria-label', /From agreement v1/);

  // 3. Wednesday's plus, then a free person: assigned.
  await page.getByRole('button', { name: 'Assign someone to Wednesday 9am to 3pm for Pw' }).click();
  const wedPicker = page.getByRole('dialog', { name: 'Assign someone to Wednesday 9am to 3pm for Pw' });
  await wedPicker.getByRole('combobox', { name: 'Find staff' }).fill(kim.token);
  await wedPicker.getByRole('option', { name: new RegExp(`^Wk ${kim.token},`) }).click();
  await expect(wedChip).toContainText(`Wk ${kim.token}`);

  // 4. Thursday's plus, then Jack from his overlapping shift: one move, and the shift he left needs staff.
  await page.getByRole('button', { name: 'Assign someone to Thursday 9am to 3pm for Pw' }).click();
  const thuPicker = page.getByRole('dialog', { name: 'Assign someone to Thursday 9am to 3pm for Pw' });
  await thuPicker.getByRole('combobox', { name: 'Find staff' }).fill(jack.token);
  await thuPicker.getByRole('option', { name: new RegExp(`^Wk ${jack.token},.*move from Thursday 9am to 5pm with Pw`) }).click();
  await expect(thuChip).toContainText(`Wk ${jack.token}`);
  expect((await shiftsOf(other.id)).find(s => s.id === jacksShift.id)!.staffId).toBeUndefined();

  // 5. Lee from the strip onto Wednesday's new-shift slot (Kim's agreed shift is already there): the prefilled panel, and the saved shift is Ad hoc.
  await page.getByRole('textbox', { name: 'Find staff' }).fill(lee.token);
  await carryOnto(page, page.getByRole('button', { name: new RegExp(`^Wk ${lee.token},`) }), page.locator(`[data-day-slot="${wednesday}"]`));
  const panel = page.getByRole('dialog', { name: 'New shift' });
  await expect(panel.getByLabel(/^Service date/)).toHaveValue(wednesday);
  await panel.getByLabel(/^Start time/).fill('15:00');
  await panel.getByLabel(/^End time/).fill('18:00');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toHaveCount(0);
  const adHoc = (await shiftsOf(participant.id)).find(s => s.serviceDate === wednesday && s.staffId === lee.id)!;
  expect(adHoc.shiftPatternId ?? null).toBeNull();
  await expect(page.locator(`[data-shift-open="${adHoc.id}"]`)).toHaveAttribute('aria-label', /Ad hoc: not from an agreement or a pattern/);
});
