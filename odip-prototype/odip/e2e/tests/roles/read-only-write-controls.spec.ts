import { Page } from '@playwright/test';
import { test, expect } from '../../support/fixtures';
import { login } from '../../support/api';
import { SEEDED } from '../../support/env';
import { makeParticipant, makeStaff, makeTrip, type Created } from '../../support/data';
import { addDays, sydneyToday } from '../../support/dates';

// Owner decision 2026-10-12: ReadOnly HIDES write controls. ReadOnlyMiddleware answers every POST, PUT, PATCH and DELETE from
// ReadOnly with 403, so /trips, /schedule and a participant page offer it no Edit, Add, Assign or status pill, and send no write.
// The Coordinator case runs the same pages as a control, so a locator that matches nothing cannot pass the ReadOnly case by accident.

let trip: Created;
let participant: Created;

test.beforeAll(async () => {
  const coord = await login(SEEDED.coordinator);
  trip = await makeTrip(coord, addDays(sydneyToday(), 14));
  // An active support worker free on the trip's dates gives the schedule an Assign cell to offer (or not).
  await makeStaff(coord);
  participant = await makeParticipant(coord);
});

function recordWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', r => {
    if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return writes;
}

test.describe('ReadOnly', () => {
  test.use({ role: SEEDED.readOnly });

  test('sees /trips, /schedule and a participant with no write controls, and sends no write', async ({ page }) => {
    const writes = recordWrites(page);

    await page.goto('/trips');
    const row = page.getByRole('row').filter({ hasText: trip.token });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /New Trip/ })).toHaveCount(0);

    await page.goto('/schedule');
    await expect(page.getByText(trip.token).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Assign / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Unassign / })).toHaveCount(0);

    await page.goto(`/participants/${participant.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(participant.token);
    await expect(page.getByRole('link', { name: /^Edit$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Edit|Add)\b/ })).toHaveCount(0);

    expect(writes).toEqual([]);
  });
});

test.describe('Coordinator (control)', () => {
  test('is offered the same write controls', async ({ page }) => {
    await page.goto('/trips');
    const row = page.getByRole('row').filter({ hasText: trip.token });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /New Trip/ })).toBeVisible();

    await page.goto('/schedule');
    await expect(page.getByText(trip.token).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Assign / }).first()).toBeVisible();

    await page.goto(`/participants/${participant.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(participant.token);
    await expect(page.getByRole('link', { name: /^Edit$/ })).toBeVisible();
  });
});
