import { test, expect, call } from '../../support/fixtures';
import { expectStatus } from '../../support/api';
import { freeIntakeStart } from '../../support/data';
import { addDays, sydneyToday } from '../../support/dates';

// The enquiry form end to end on the real API and PostgreSQL (spec 2026-10-16): one Save captures the enquiry, its main contact, another contact and
// the intake visit. The stack has no SMTP, so the visit books and the summary says the invite wasn't sent. Day +3 from 2 pm, at a time the coordinator
// is free: intake-booking.spec.ts books the same coordinator on day +2, and the staff-busy check refuses an overlap.
const token = `${(process.pid % 4096).toString(36)}${Date.now().toString(36).slice(-5)}`;
// The visit's Date field, not the participant details' Date of birth (both are in the DOM; the details fold is closed).
const VISIT_DATE = /^Date(?! of birth)/;

test('a coordinator captures an enquiry with a contact and a visit in one save, then closes it', async ({ page, session }) => {
  const last = `Form${token}`;
  const day = addDays(sydneyToday(), 3);
  const start = await freeIntakeStart(session, day, '14:00');
  let id: string | undefined;
  let closed = false;
  try {
    await page.goto('/participants/new-inquiry');
    await page.locator('#inquiry-first-name').fill('Mia');
    await page.locator('#inquiry-last-name').fill(last);
    await page.locator('#inquiry-contact-first-name').fill('Sofia');
    await page.locator('#inquiry-contact-last-name').fill(last);
    await page.locator('#inquiry-email').fill(`sofia.${token}@example.com`);
    await page.getByRole('button', { name: 'Add contact' }).click();
    const contact = page.getByRole('group', { name: 'Contact 1' });
    await contact.getByLabel(/^First name/).fill('Maria');
    await contact.getByLabel(/^Last name/).fill(last);
    await contact.getByLabel(/^Role/).selectOption('Guardian');
    await page.getByRole('checkbox', { name: /book the intake visit now/i }).check();
    await page.getByLabel(VISIT_DATE).fill(day);
    await page.getByLabel(/^Start time/).fill(start);
    await page.getByLabel(/^Where/).fill('Community centre, Room 2');
    await page.getByRole('button', { name: 'Capture enquiry' }).click();

    await expect(page).toHaveURL(/\/participants\?tab=enquiries/);
    await expect(page.getByText('Enquiry saved, invite not sent')).toBeVisible();
    await expect(page.getByText(/1 contact saved\./)).toBeVisible();

    const list = await expectStatus('list enquiries', 200, await call(session, 'GET', '/inquiries'));
    const row = list.data.find((r: { lastName: string }) => r.lastName === last);
    id = row.id;
    expect(row.intakeStartsAt).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('Maria'); // pending contacts never ride on the list
    expect(row.contactFirstName).toBe('Sofia'); // the main contact does, for a Coordinator
    const one = await expectStatus('one enquiry', 200, await call(session, 'GET', `/inquiries/${id}`));
    expect(one.data.contacts).toEqual([expect.objectContaining({ role: 'Guardian', firstName: 'Maria', lastName: last })]);

    // Close it from the row menu: its visit is cancelled with it (no invite had gone, so nobody is emailed), and it moves to the Closed view.
    await page.getByRole('button', { name: `More actions for Mia ${last}` }).click();
    await page.getByRole('option', { name: 'Close enquiry' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel(/^Why is it closing/).selectOption('NotGoingAhead');
    await dialog.getByRole('button', { name: 'Close enquiry' }).click();
    await expect(page.getByText(`Mia ${last}'s enquiry is closed: Not going ahead.`)).toBeVisible();
    closed = true;
    const after = await expectStatus('closed list', 200, await call(session, 'GET', '/inquiries/closed'));
    const gone = after.data.items.find((r: { id: string }) => r.id === id);
    expect(gone.closeOutcome).toBe('NotGoingAhead');
    expect(gone.intakeStartsAt ?? null).toBeNull(); // the visit was cancelled with it
    await page.getByRole('radio', { name: 'Closed' }).click();
    await expect(page.getByRole('row', { name: new RegExp(last) })).toContainText('Not going ahead');
  } finally {
    // Closing cancels the booking too, and a booking left behind would make a retry's own booking a staff-busy 409.
    if (id && !closed) await call(session, 'POST', `/inquiries/${id}/close`, { outcome: 'Other' });
  }
});

// L7 and owner decision 4: a first name is enough to save, and a visit books with no email; nobody is emailed and no send is recorded.
test('an enquiry with only a first name books a visit without an email, and nobody is emailed', async ({ page, session }) => {
  const first = `Nia${token}`;
  const day = addDays(sydneyToday(), 4);
  const start = await freeIntakeStart(session, day, '14:00');
  let id: string | undefined;
  try {
    await page.goto('/participants/new-inquiry');
    await page.locator('#inquiry-first-name').fill(first);
    await page.getByRole('checkbox', { name: /book the intake visit now/i }).check();
    await expect(page.getByText('Saving books the visit without an invite: the main contact has no email.')).toBeVisible();
    await page.getByLabel(VISIT_DATE).fill(day);
    await page.getByLabel(/^Start time/).fill(start);
    await page.getByLabel(/^Where/).fill('Community centre, Room 3');
    await page.getByRole('button', { name: 'Capture enquiry' }).click();

    await expect(page).toHaveURL(/\/participants\?tab=enquiries/);
    await expect(page.getByText(/No invite sent: the main contact has no email\./)).toBeVisible();
    const list = await expectStatus('list enquiries', 200, await call(session, 'GET', '/inquiries'));
    const row = list.data.find((r: { firstName: string }) => r.firstName === first);
    id = row.id;
    expect(row.lastName).toBe('');
    expect(row.intakeStartsAt).toBeTruthy();
    expect(row.intakeInviteSentAt ?? null).toBeNull();
    expect(row.intakeInviteError ?? null).toBeNull();
  } finally {
    if (id) await call(session, 'POST', `/inquiries/${id}/close`, { outcome: 'Other' });
  }
});
