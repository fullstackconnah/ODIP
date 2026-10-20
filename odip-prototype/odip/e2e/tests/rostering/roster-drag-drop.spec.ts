import { Locator, Page } from '@playwright/test';
import { test, expect, call } from '../../support/fixtures';
import { assignShift, makeParticipant, makeShift, makeStaff, startWeek } from '../../support/data';
import { addDays, mondayOf, nextWednesday } from '../../support/dates';

// Roster board drag and drop (spec 2026-10-14), on the real API and PostgreSQL. A person carried from the staff strip fills a Needs staff shift (/assign); the same person,
// lifted off it by the grip, swaps with a colleague on the next day (one move-staff request). Real mouse moves in steps: dnd-kit's MouseSensor lifts after 4px.
async function carry(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error('the drag source or target is not on screen');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
  // dnd-kit swallows clicks on the document for 50 ms after a drop (its sensors' post-drag click guard), so a click on the prompt that opens at once could be lost.
  await page.waitForTimeout(150);
}

test('a person from the strip fills a Needs staff shift, then swaps with a colleague', async ({ page, session }) => {
  const participant = await makeParticipant(session);
  const alex = await makeStaff(session);
  const sam = await makeStaff(session);
  const wednesday = nextWednesday();
  const open = await makeShift(session, participant.id, wednesday);              // Draft, nobody on it: "Needs staff"
  const samsShift = await makeShift(session, participant.id, addDays(wednesday, 1));
  await assignShift(session, samsShift.id, sam.id);

  // Its shifts are one-offs, so the week reads as unstarted until Start rostering (2026-10-16): the grid would sit under the Start card.
  await startWeek(session, wednesday);
  await page.goto(`/rostering?date=${wednesday}&participant=${participant.id}`);
  const openPuck = page.locator(`[data-shift-open="${open.id}"]`);
  const samsPuck = page.locator(`[data-shift-open="${samsShift.id}"]`);
  await expect(openPuck).toHaveAttribute('aria-label', /Needs staff/);

  // From the strip: the search finds the new person, and the drop assigns them.
  await page.getByRole('textbox', { name: 'Find staff' }).fill(alex.token);
  await carry(page, page.getByRole('button', { name: new RegExp(`^Wk ${alex.token},`) }), openPuck);
  await expect(openPuck).toContainText(`Wk ${alex.token}`);

  // Off the puck by its grip, onto Sam's shift: the prompt offers Swap.
  await carry(page, page.getByRole('button', { name: `Drag to move Wk ${alex.token} to another shift or day` }), samsPuck);
  await page.getByRole('alertdialog', { name: `Wk ${sam.token} is on this shift` }).getByRole('button', { name: 'Swap' }).click();
  await expect(samsPuck).toContainText(`Wk ${alex.token}`);
  await expect(openPuck).toContainText(`Wk ${sam.token}`);

  // The server agrees.
  const board = await call(session, 'GET', `/rostering/board?weekStart=${mondayOf(wednesday)}&groupBy=participant`);
  const row = board.data.participantRows.find((r: { participantId: string }) => r.participantId === participant.id);
  const staffOn = (id: string) => (row.shifts as { id: string; staffId?: string }[]).find(s => s.id === id)?.staffId;
  expect(staffOn(open.id)).toBe(sam.id);
  expect(staffOn(samsShift.id)).toBe(alex.id);
});

// The ⋮ menu's "Swap with…" (the lead's decision 1, 2026-10-15): the same move-staff Swap a drag sends, chosen from the swap picker.
test('a shift\'s menu swaps its person with a colleague on another shift', async ({ page, session }) => {
  const participant = await makeParticipant(session);
  const alex = await makeStaff(session);
  const sam = await makeStaff(session);
  const wednesday = nextWednesday();
  const alexsShift = await makeShift(session, participant.id, wednesday);
  const samsShift = await makeShift(session, participant.id, addDays(wednesday, 1));
  await assignShift(session, alexsShift.id, alex.id);
  await assignShift(session, samsShift.id, sam.id);

  // Its shifts are one-offs, so the week reads as unstarted until Start rostering (2026-10-16): the grid would sit under the Start card.
  await startWeek(session, wednesday);
  await page.goto(`/rostering?date=${wednesday}&participant=${participant.id}`);
  const alexsPuck = page.locator(`[data-shift-open="${alexsShift.id}"]`);
  const samsPuck = page.locator(`[data-shift-open="${samsShift.id}"]`);
  await expect(alexsPuck).toContainText(`Wk ${alex.token}`);

  await page.locator(`[data-shift-chip="${alexsShift.id}"]`).getByRole('button', { name: /^Actions for/ }).click();
  await page.getByRole('option', { name: /^Swap .* with…$/ }).click();
  const picker = page.getByRole('dialog', { name: /^Swap .* with…$/ });
  await picker.getByRole('combobox', { name: 'Find staff' }).fill(sam.token);
  await picker.getByRole('option', { name: new RegExp(`^Wk ${sam.token}, `) }).click();
  await expect(alexsPuck).toContainText(`Wk ${sam.token}`);
  await expect(samsPuck).toContainText(`Wk ${alex.token}`);

  const board = await call(session, 'GET', `/rostering/board?weekStart=${mondayOf(wednesday)}&groupBy=participant`);
  const row = board.data.participantRows.find((r: { participantId: string }) => r.participantId === participant.id);
  const staffOn = (id: string) => (row.shifts as { id: string; staffId?: string }[]).find(s => s.id === id)?.staffId;
  expect(staffOn(alexsShift.id)).toBe(sam.id);
  expect(staffOn(samsShift.id)).toBe(alex.id);
});
