import type { Locator, Page } from '@playwright/test';
import { test, expect, call } from '../../support/fixtures';
import { expectStatus, login } from '../../support/api';
import { makeParticipant, uniqueToken } from '../../support/data';
import { SEEDED } from '../../support/env';

// Owner decisions 2026-10-14, end to end on the real API and PostgreSQL: each practice on the register is badged Authorised or Not authorised
// (active, with who authorised it and when); a Not authorised one locks "This use was not authorised"; "None of these" can be added to the
// register from the incident, which then links the new (Not authorised) entry; and a support worker's "None of these" asks a coordinator to.
// The participant and its register are synthetic data of this spec (the last name sorts early, inside the picker's first page).

/** Waits until no animation or transition is running, so a capture is not taken mid-fade (as participant-import.spec.ts does). */
const settled = (p: Page) => p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));

/** Basics for an RP incident about this participant, then Next onto the Restrictive practice step, with Physical restraint picked. */
async function toRpStep(page: Page, title: string, participantName: string) {
  await page.goto('/incidents/new');
  await page.getByPlaceholder('Brief incident summary').fill(title);
  await page.getByLabel('Involved Participant').click();
  await page.getByRole('option', { name: participantName }).click();
  await page.getByLabel('Incident Type *', { exact: true }).click();
  await page.getByRole('option', { name: /Restrictive Practice Use/i }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Restrictive Practice Type/).click();
  await page.getByRole('option', { name: /^Physical restraint/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Which practice was used?' })).toBeVisible();
}

test('a coordinator sees which practices are authorised, adds a "None of these" to the register, and the incident is stored not authorised @incidents', async ({ page, session }, testInfo) => {
  test.setTimeout(150_000);
  const token = uniqueToken('ARP');
  const participant = await makeParticipant(session, token);
  const name = `Pw ${token}`;
  await expectStatus('seed the register', 200, await call(session, 'POST', `/participants/${participant.id}/restrictive-practices/bulk`, { items: [
    { type: 'PhysicalRestraint', description: 'Two-person hold during transfers.', authorisedBy: 'Dr Chen', authorisationDate: '2026-09-01', reviewDate: '2027-03-01', isActive: true },
    { type: 'PhysicalRestraint', description: 'Hand-over-hand guidance.', authorisedBy: null, authorisationDate: null, reviewDate: null, isActive: true },
  ] }));
  const desk = (shot: string) => settled(page).then(() => page.screenshot({ path: testInfo.outputPath(`${shot}-1440.png`), fullPage: true }));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toRpStep(page, `Held at the kerb ${token}`, name);
  const row = (text: string) => page.locator('label').filter({ has: page.getByRole('radio', { name: new RegExp(text) }) });
  await expect(row('Two-person hold').getByText('Authorised', { exact: true })).toBeVisible();
  await expect(row('Hand-over-hand').getByText('Not authorised', { exact: true })).toBeVisible();
  await desk('rp-step-badges');

  await page.getByRole('radio', { name: /Hand-over-hand/ }).check();
  const notAuthorised = page.getByRole('checkbox', { name: 'This use was not authorised' });
  await expect(notAuthorised).toBeChecked();
  await expect(notAuthorised).toBeDisabled();
  await expect(page.getByText('Not authorised — this may be a reportable incident.')).toBeVisible();
  await desk('rp-step-locked');

  await page.getByRole('radio', { name: /None of these — the practice used is not on this participant's register/ }).check();
  await page.getByLabel(/Describe the restrictive practice that was used/).fill('Held both arms at the kerb to stop him running onto the road.');
  await page.getByRole('button', { name: 'Add to restrictive practice register' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to restrictive practice register — Physical restraint' });
  await expect(dialog.getByLabel('Description, row 1')).toHaveValue('Held both arms at the kerb to stop him running onto the road.');
  await desk('rp-add-dialog');
  await dialog.getByRole('button', { name: 'Save 1 entry' }).click();
  await expect(dialog).toBeHidden();

  const added = page.getByRole('radio', { name: /Held both arms at the kerb/ });
  await expect(added).toBeChecked();
  await expect(row('Held both arms at the kerb').getByText('Not authorised', { exact: true })).toBeVisible();
  await expect(notAuthorised).toBeChecked();
  await expect(notAuthorised).toBeDisabled();
  await expect(page.getByLabel(/Describe what was actually done/)).toHaveValue('Held both arms at the kerb to stop him running onto the road.');
  await desk('rp-step-relinked');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Date & Time/).fill('2026-10-13T10:00');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('button', { name: /submit incident report/i })).toBeVisible();
  await desk('rp-review');
  await page.getByRole('button', { name: /submit incident report/i }).click();
  await expect(page).toHaveURL(/\/incidents$/);

  // Stored: linked to the new entry, not authorised; the register has the new entry, saved without authorisation details.
  const register = await expectStatus('read the register', 200, await call(session, 'GET', `/participants/${participant.id}/restrictive-practices`));
  const entry = (register.data as any[]).find(p => p.description.startsWith('Held both arms'));
  // The API leaves null fields out of the JSON.
  expect(entry).toMatchObject({ type: 'PhysicalRestraint', isActive: true });
  expect([entry.authorisedBy ?? null, entry.authorisationDate ?? null]).toEqual([null, null]);
  const list = await expectStatus('list incidents', 200, await call(session, 'GET', '/incidents?pageSize=100'));
  const listed = (list.data.items as any[]).find(i => i.title === `Held at the kerb ${token}`);
  const incident = await expectStatus('read the incident', 200, await call(session, 'GET', `/incidents/${listed.id}`));
  expect(incident.data).toMatchObject({ restrictivePracticeId: entry.id, isRestrictivePracticeAuthorised: false, qscReportingStatus: 'Required' });
  expect(incident.data.unapprovedRestrictivePracticeDetails ?? null).toBeNull();

  await page.goto(`/incidents/${listed.id}`);
  // The card: the heading sits in its title row.
  const block = page.getByRole('heading', { name: 'Restrictive practice', exact: true }).locator('xpath=../..');
  await expect(block.getByText('Held both arms at the kerb to stop him running onto the road.')).toBeVisible();
  await expect(block.getByText('Not authorised', { exact: true })).toBeVisible();
  await desk('incident-detail');

  // A support worker's "None of these" (by API, as the wizard sends it) asks a coordinator to add it; nothing is written to the register.
  const worker = await login(SEEDED.supportWorker);
  await expectStatus('support worker reports', 200, await call(worker, 'POST', '/incidents', {
    reportedByStaffId: worker.user.id, incidentType: 'RestrictivePracticeUse', restrictivePracticeType: 'Seclusion', involvedParticipantId: participant.id,
    unapprovedRestrictivePracticeDetails: 'Shut in the quiet room.', severity: 'Medium', title: `Quiet room ${token}`, description: 'Shut in the quiet room.',
    incidentDateTime: '2026-10-13T11:00:00', serviceType: 'None', wereEmergencyServicesCalled: false, injuries: [], witnesses: [],
  }));
  const tasks = await expectStatus('coordinator task list', 200, await call(session, 'GET', '/tasks'));
  const titles = ((tasks.data.items ?? tasks.data) as any[]).map(t => t.title);
  expect(titles).toContain(`Add seclusion to ${name}'s restrictive practice register`);
  const after = await expectStatus('read the register again', 200, await call(session, 'GET', `/participants/${participant.id}/restrictive-practices`));
  expect((after.data as any[]).length).toBe(3);

  // Phone: a new page loaded at 390 px (it shares the signed-in storage), so no desktop layout is left behind.
  const phone = await page.context().newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  // With `focus`, the capture is the screen around it: a full-page capture draws the fixed bottom bar and a dialog's backdrop mid-page.
  const narrow = async (shot: string, focus?: Locator) => {
    if (focus) await focus.evaluate(e => e.scrollIntoView({ block: 'center' }));
    await settled(phone);
    const wide = await phone.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(e => e.getBoundingClientRect().right > 391).slice(0, 5)
      .map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 80)} right=${Math.round(e.getBoundingClientRect().right)}`));
    expect(await phone.evaluate(() => document.documentElement.scrollWidth), `${shot} is wider than 390 px: ${wide.join(' | ')}`).toBeLessThanOrEqual(390);
    await phone.screenshot({ path: testInfo.outputPath(`${shot}-390.png`), fullPage: !focus });
  };
  await toRpStep(phone, `Phone check ${token}`, name);
  await phone.getByRole('radio', { name: /Hand-over-hand/ }).check();
  await expect(phone.getByRole('checkbox', { name: 'This use was not authorised' })).toBeDisabled();
  await narrow('rp-step-badges');
  await narrow('rp-step-locked', phone.getByRole('checkbox', { name: 'This use was not authorised' }));
  await phone.getByRole('radio', { name: /None of these/ }).check();
  await phone.getByLabel(/Describe the restrictive practice that was used/).fill('Blocked the doorway with a chair.');
  await phone.getByRole('button', { name: 'Add to restrictive practice register' }).click();
  await expect(phone.getByRole('dialog', { name: /Add to restrictive practice register/ })).toBeVisible();
  await narrow('rp-add-dialog', phone.getByRole('dialog'));
  await phone.close();
});
