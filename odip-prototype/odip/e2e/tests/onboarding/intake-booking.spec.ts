import { test, expect, call } from '../../support/fixtures';
import { expectStatus } from '../../support/api';
import { clockLabel, freeIntakeStart } from '../../support/data';
import { addDays, mondayOf, sydneyToday } from '../../support/dates';

// Intake booking end to end on the real API and PostgreSQL (spec 2026-10-14): book from the enquiry row, see it in the table, on the Schedule
// page and on My shifts, then cancel. The stack has no SMTP, so the invite is stored as not sent: the booking must still save and say so.
const token = `${(process.pid % 4096).toString(36)}${Date.now().toString(36).slice(-5)}`;

test('a coordinator books an intake visit, sees it on the schedules, and cancels it', async ({ page, session }) => {
  const first = 'Ivy';
  const last = `Intake${token}`;
  const name = `${first} ${last}`;
  const created = await expectStatus('create an enquiry', 200, await call(session, 'POST', '/inquiries', {
    firstName: first, lastName: last, phone: '0400 000 111', email: `ivy.${token}@example.com`, source: 'Phone',
  }));
  const day = addDays(sydneyToday(), 2);
  // From 10 am, at a time the coordinator is free: booking refuses a staff member with a shift or another visit then (plan check S5).
  const start = await freeIntakeStart(session, day, '10:00');
  try {
    // 1. Book it from the row: the panel stays open and says what the email did.
    await page.goto('/participants?tab=enquiries');
    await page.getByRole('button', { name: `Book intake for ${name}` }).click();
    const panel = page.getByRole('dialog', { name: `Intake visit for ${name}` });
    await panel.getByLabel(/^Date/).fill(day);
    await panel.getByLabel(/^Start time/).fill(start);
    await panel.getByLabel(/^Where/).fill('Community centre, Room 2');
    await panel.getByRole('button', { name: 'Send invite' }).click();
    await expect(panel.getByText(`Invite not sent: email isn't set up yet. The visit is still booked, so let ${first} know another way.`)).toBeVisible();
    await panel.getByRole('button', { name: 'Close', exact: true }).click(); // exact: the header X is "Close panel"

    // 2. In the table: line 1 (focused after the close), its badge and the invite line.
    await expect(page.getByRole('button', { name: new RegExp(`${clockLabel(start)} · .+, intake visit for ${name}$`) })).toBeFocused();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row.getByText('Not confirmed')).toBeVisible();
    await expect(row.getByText("Invite not sent: email isn't set up yet")).toBeVisible();

    // 3. On the Schedule page's Intake visits section, and on the booking coordinator's My shifts.
    await page.goto('/schedule');
    await expect(page.getByRole('heading', { level: 2, name: 'Intake visits' })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible(); // exact: the Start intake button's hidden suffix also holds the name
    await page.goto('/portal');
    if (mondayOf(day) !== mondayOf(sydneyToday())) await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible(); // exact: the Start intake button's hidden suffix also holds the name
    await expect(page.getByRole('button', { name: `Start intake for ${name}` })).toBeVisible();

    // 4. Cancel it. No invite went out, so nobody is emailed, and Book intake is back with focus.
    await page.goto('/participants?tab=enquiries');
    await page.getByRole('button', { name: new RegExp(`intake visit for ${name}$`) }).click();
    await page.getByRole('dialog', { name: `Intake visit for ${name}` }).getByRole('button', { name: 'Cancel visit' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('No invite went out, so nobody is emailed.');
    await confirm.getByRole('button', { name: 'Cancel visit' }).click();
    await expect(page.getByText('No invite had gone out, so nobody was emailed.')).toBeVisible();
    await expect(page.getByRole('button', { name: `Book intake for ${name}` })).toBeFocused();
  } finally {
    // A booking left behind (a failed run) would make a retry's own booking a staff-busy 409. After a green run it is already cancelled: a 404.
    await call(session, 'DELETE', `/inquiries/${created.data.id}/intake-booking`);
  }
});
