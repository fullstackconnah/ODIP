import { test, expect, call } from '../../support/fixtures';
import { expectStatus, login } from '../../support/api';
import { SEEDED } from '../../support/env';
import { addDays, sydneyToday } from '../../support/dates';

// The bell (dashboard PR B): a support worker's leave request reaches every approver's bell at once, with email off
// (Notifications:Enabled is false in this stack, as on live). Opening the item marks it read and goes to the leave queue.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

test.describe('the bell', () => {
  test.use({ role: SEEDED.coordinator });

  test('a leave request makes a new bell item for the approver, and opening it marks it read', async ({ page, session }) => {
    const worker = await login(SEEDED.supportWorker);
    // A day far out, and different on each run, so it never repeats an identical request (409).
    const day = addDays(sydneyToday(), 300 + Math.floor(Math.random() * 300));
    const created = await expectStatus('request leave', 201, await call(worker, 'POST', '/portal/leave', {
      leaveType: 'Annual', startDate: day, endDate: day, reason: 'e2e bell',
    }));

    try {
      const [, month, date] = day.split('-').map(Number);
      const title = `${String(worker.user.fullName)} asked for annual leave, ${date} ${MONTHS[month - 1]}.`;
      const inbox = await expectStatus('inbox', 200, await call(session, 'GET', '/notifications/inbox?take=30'));
      const item = inbox.data.items.find((n: { title: string }) => n.title === title);
      expect(item, `the approver's inbox has "${title}" (plain text, not HTML-encoded)`).toBeTruthy();
      expect(item.readAt).toBeUndefined();
      expect(item.linkTo).toBe('/rostering/leave');

      await page.goto('/trips');
      const bell = page.getByRole('button', { name: /unread, Notifications$/ });
      await expect(bell).toBeVisible();
      await bell.click();
      await expect(page.getByRole('heading', { level: 2, name: 'Notifications' })).toBeVisible();

      await page.getByRole('link', { name: `Unread: ${title}` }).click();
      await page.waitForURL('**/rostering/leave');

      await expect.poll(async () => {
        const after = await call(session, 'GET', '/notifications/inbox?take=30');
        return after.data.items.find((n: { id: string }) => n.id === item.id)?.readAt ?? null;
      }).not.toBeNull();
    } finally {
      // Leave nothing pending behind for other specs: the worker withdraws the request.
      await call(worker, 'POST', `/portal/leave/${created.data.id}/cancel`);
    }
  });

  // Plan check S2: through the real pipeline (ReadOnlyMiddleware, [Authorize], the controller), a ReadOnly user may mark
  // their own bell read, and every other write is still refused.
  test('a ReadOnly user may mark their own bell read, and nothing else', async () => {
    const readOnly = await login(SEEDED.readOnly);
    await expectStatus('read-all as ReadOnly', 204, await call(readOnly, 'POST', '/notifications/inbox/read-all'));
    await expectStatus('another write as ReadOnly', 403, await call(readOnly, 'POST', '/portal/leave', {
      leaveType: 'Annual', startDate: sydneyToday(), endDate: sydneyToday(), reason: 'e2e read-only',
    }));
  });
});
