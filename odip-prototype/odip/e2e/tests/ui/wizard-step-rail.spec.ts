import { test, expect } from '@playwright/test';

for (const width of [1440, 1024, 390]) {
  test.describe(`caregiver step rail at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 }, hasTouch: width === 390 });

    test('connectors follow the step markers inside the rail', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/v1/public/caregiver/synthetic-rail-layout', route => route.fulfill({
        json: { data: {
          status: 'Draft', caregiverName: null, caregiverRelationship: null,
          expiresAt: '2099-01-01T00:00:00Z', rejectionNote: null,
          current: { firstName: 'Synthetic', lastName: 'Example' }, editable: [], draft: null,
        } },
      }));
      await page.goto('/caregiver/synthetic-rail-layout');
      const rail = page.getByRole('navigation', { name: 'Caregiver form steps' });
      await expect(rail).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const geometry = await rail.evaluate(nav => Array.from(nav.querySelectorAll('li')).slice(0, -1).map(item => {
        const button = item.querySelector('button')!;
        const marker = button.querySelector('span')!.getBoundingClientRect();
        const connector = Array.from(item.querySelectorAll(':scope > span')).find(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (!connector) throw new Error('A step connector is missing');
        const line = connector.getBoundingClientRect();
        const control = button.getBoundingClientRect();
        return {
          markerX: marker.x + marker.width / 2,
          markerY: marker.y + marker.height / 2,
          lineX: line.x + line.width / 2,
          lineY: line.y + line.height / 2,
          lineWidth: line.width, lineHeight: line.height,
          buttonHeight: control.height,
        };
      }));
      expect(geometry.length).toBeGreaterThan(0);
      for (const line of geometry) {
        if (width >= 1024) {
          expect(Math.abs(line.markerX - line.lineX), 'vertical connector follows its marker').toBeLessThanOrEqual(1);
          expect(line.lineHeight).toBeGreaterThan(line.lineWidth);
        } else {
          expect(Math.abs(line.markerY - line.lineY), 'horizontal connector follows its marker').toBeLessThanOrEqual(1);
          expect(line.lineWidth).toBeGreaterThan(line.lineHeight);
          expect(line.buttonHeight).toBeGreaterThanOrEqual(44);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      await testInfo.attach('step-rail', { body: await rail.screenshot(), contentType: 'image/png' });
    });
  });
}
