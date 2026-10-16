import { test, expect, call } from '../../support/fixtures';
import { expectStatus } from '../../support/api';
import { freeIntakeStart } from '../../support/data';
import { addDays, sydneyToday } from '../../support/dates';

// The enquiry form end to end on the real API and PostgreSQL (spec 2026-10-16): one Save captures the enquiry, its contact and the intake visit.
// The stack has no SMTP, so the visit books and the summary says the invite wasn't sent. Day +3 from 2 pm, at a time the coordinator is free:
// intake-booking.spec.ts books the same coordinator on day +2, and the staff-busy check refuses an overlap.
const token = `${(process.pid % 4096).toString(36)}${Date.now().toString(36).slice(-5)}`;

test('a coordinator captures an enquiry with a contact and books the intake visit in one save', async ({ page, session }) => {
  const last = `Form${token}`;
  const day = addDays(sydneyToday(), 3);
  const start = await freeIntakeStart(session, day, '14:00');
  let id: string | undefined;
  try {
    await page.goto('/participants/new-inquiry');
    await page.locator('#inquiry-first-name').fill('Mia');
    await page.locator('#inquiry-last-name').fill(last);
    await page.locator('#inquiry-email').fill(`mia.${token}@example.com`);
    await page.getByRole('button', { name: 'Add contact' }).click();
    const contact = page.getByRole('group', { name: 'Contact 1' });
    await contact.getByLabel(/^First name/).fill('Maria');
    await contact.getByLabel(/^Last name/).fill(last);
    await contact.getByLabel(/^Role/).selectOption('Guardian');
    await page.getByRole('checkbox', { name: /book the intake visit now/i }).check();
    await page.getByLabel(/^Date/).fill(day);
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
    const one = await expectStatus('one enquiry', 200, await call(session, 'GET', `/inquiries/${id}`));
    expect(one.data.contacts).toEqual([expect.objectContaining({ role: 'Guardian', firstName: 'Maria', lastName: last })]);
  } finally {
    // A booking left behind would make a retry's own booking a staff-busy 409.
    if (id) await call(session, 'DELETE', `/inquiries/${id}/intake-booking`);
  }
});
