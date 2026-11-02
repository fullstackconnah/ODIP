import { test, expect } from '@playwright/test';

for (const width of [1440, 1024, 390]) {
  test.describe(`caregiver step progress at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 }, hasTouch: width === 390 });

    test('compact progress opens to the full list of 8 steps', async ({ page }, testInfo) => {
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
      const line = page.getByText('Step 1 of 8 · About you');
      await expect(line).toBeVisible();
      const steps = page.getByRole('navigation', { name: 'Caregiver form steps' });
      await expect(steps).toBeHidden();
      await line.click();
      await expect(steps).toBeVisible();
      await expect(steps.getByRole('listitem')).toHaveCount(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      await testInfo.attach('step-progress', { body: await page.screenshot(), contentType: 'image/png' });
    });
  });
}
