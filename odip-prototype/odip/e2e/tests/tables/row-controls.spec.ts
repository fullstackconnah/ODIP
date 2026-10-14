import { test, expect, call } from '../../support/fixtures';
import { expectStatus } from '../../support/api';
import { uniqueToken } from '../../support/data';
import { SEEDED } from '../../support/env';
import { sydneyToday } from '../../support/dates';

// Representative PR238 ghost-danger small row action, using the built application's
// actual CSS. A VIC-only synthetic past holiday cannot alter the NSW agreement fixtures.
for (const touch of [false, true]) {
  test.describe(touch ? 'touch row controls' : 'desktop row controls', () => {
    test.use({ role: SEEDED.superAdmin, hasTouch: touch, viewport: { width: 1440, height: 900 } });
    test('holiday delete stays compact, is named for its row, and opens only its confirmation', async ({ page, session }, testInfo) => {
      const name = uniqueToken('RowControl');
      const date = `${sydneyToday().slice(0, 4)}-01-01`;
      const created = (await expectStatus('create synthetic holiday', 200, await call(session, 'POST', '/public-holidays', { date, name, state: 'VIC' }))).data;
      try {
        await page.goto('/settings');
        await page.getByRole('tab', { name: 'Public holidays', exact: true }).click();
        const button = page.getByRole('button', { name: new RegExp(`^Delete: ${name},.*\\(VIC\\)$`) });
        await expect(button).toBeVisible();
        await button.scrollIntoViewIfNeeded();
        const row = button.locator('xpath=ancestor::tr');
        const box = await button.boundingBox();
        const rowBox = await row.boundingBox();
        expect(box).not.toBeNull();
        expect(rowBox).not.toBeNull();
        expect(box!.height).toBe(touch ? 36 : 24);
        expect(rowBox!.height).toBe(touch ? 48 : 34);
        expect(box!.y).toBeGreaterThanOrEqual(rowBox!.y);
        expect(box!.y + box!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height);
        const style = await button.evaluate(el => {
          const s = getComputedStyle(el);
          const pseudo = getComputedStyle(el, '::before');
          // Resolve the custom-property colour to the browser's serialized colour format.
          const probe = document.createElement('span');
          probe.style.color = 'var(--color-destructive)';
          el.appendChild(probe);
          const destructive = getComputedStyle(probe).color;
          probe.remove();
          return { colour: s.color, destructive, padWidth: Math.max(parseFloat(pseudo.width), parseFloat(pseudo.minWidth)), padHeight: Math.max(parseFloat(pseudo.height), parseFloat(pseudo.minHeight)), coarse: matchMedia('(pointer: coarse)').matches };
        });
        expect(style.coarse).toBe(touch);
        expect(style.colour, 'destructive action remains red at rest').toBe(style.destructive);
        if (touch) {
          expect(style.padWidth).toBeGreaterThanOrEqual(44);
          expect(style.padHeight).toBeGreaterThanOrEqual(44);
          // Two pixels outside the painted 36px button but within its 44px hit pad.
          // This proves the target really receives the tap, not merely that a token exists.
          await page.touchscreen.tap(box!.x + box!.width / 2, box!.y - 2);
        } else {
          // Keyboard modality plus real Tab traversal, rather than programmatic focus.
          await page.keyboard.press('Control+Home');
          for (let i = 0; i < 200 && !(await button.evaluate(el => el === document.activeElement)); i++) {
            await page.keyboard.press('Tab');
          }
          await expect(button).toBeFocused();
          expect(await button.evaluate(el => el.matches(':focus-visible'))).toBe(true);
          expect(await button.evaluate(el => getComputedStyle(el).boxShadow), 'visible keyboard focus ring').not.toBe('none');
          await testInfo.attach('keyboard-focus', { body: await row.screenshot(), contentType: 'image/png' });
          await page.keyboard.press('Enter');
        }
        const dialog = page.getByRole('dialog', { name: 'Delete Public Holiday', exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(name);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(button).toBeVisible();
        const holidays = (await expectStatus('read holidays after cancel', 200, await call(session, 'GET', `/public-holidays?year=${date.slice(0, 4)}&state=VIC`))).data;
        expect(holidays.some((h: { id: string }) => h.id === created.id), 'cancel never deletes the row').toBe(true);
        await testInfo.attach('row-layout', { body: await row.screenshot(), contentType: 'image/png' });
      } finally {
        await expectStatus('remove only this synthetic test holiday', 200, await call(session, 'DELETE', `/public-holidays/${created.id}`));
      }
    });
  });
}
