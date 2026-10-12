import { Page } from '@playwright/test';
import { test, expect, call } from '../../support/fixtures';
import { expectStatus, login } from '../../support/api';
import { SEEDED } from '../../support/env';
import { makeParticipant, makeStaff, makeTrip, type Created } from '../../support/data';
import { addDays, sydneyToday } from '../../support/dates';

// Owner decision 2026-10-12: ReadOnly HIDES write controls. ReadOnlyMiddleware answers every POST, PUT, PATCH and DELETE from
// ReadOnly with 403, so /trips, /schedule and a participant page offer it no Edit, Add, Assign or status pill, and send no write.
// The Coordinator case runs the same pages as a control, so a locator that matches nothing cannot pass the ReadOnly case by accident.

let trip: Created;
let participant: Created;
let taskId: string;
let medicationId: string;

test.beforeAll(async () => {
  const coord = await login(SEEDED.coordinator);
  trip = await makeTrip(coord, addDays(sydneyToday(), 14));
  // An active support worker free on the trip's dates gives the schedule an Assign cell to offer (or not).
  await makeStaff(coord);
  participant = await makeParticipant(coord);
  // A task and a medication are read through their forms, which open as a view for ReadOnly.
  const task = await expectStatus('create task', 200, await call(coord, 'POST', '/tasks', {
    tripInstanceId: trip.id, taskType: 'Other', title: `Task ${trip.token}`, priority: 'Medium', notes: 'Read me',
  }));
  taskId = task.data.id;
  const med = await expectStatus('create medication', [200, 201], await call(coord, 'POST', `/participants/${participant.id}/medications`, {
    name: `Med ${participant.token}`, doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', type: 'Regular',
    timesOfDay: '08:00', startDate: `${sydneyToday()}T00:00:00`, consentObtained: true,
  }));
  medicationId = med.data.id;
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

    // TRIPS-3: the Activities tab used to send POST .../schedule/generate for ReadOnly.
    await page.goto(`/trips/${trip.id}?tab=activities`);
    await expect(page.getByRole('tab', { name: /Activities/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('No schedule yet.').or(page.getByText(/^D1$/)).first()).toBeVisible();

    // The task and the medication open as views: fields disabled, no Save.
    await page.goto(`/tasks/${taskId}/edit`);
    await expect(page.getByRole('heading', { name: 'View task' })).toBeVisible();
    await expect(page.locator('input[name="title"]')).toBeDisabled();
    await expect(page.locator('textarea[name="notes"]')).toHaveValue('Read me');
    await expect(page.getByRole('button', { name: /Save/ })).toHaveCount(0);

    await page.goto(`/medications/${medicationId}/edit`);
    await expect(page.getByRole('heading', { name: 'View medication' })).toBeVisible();
    await expect(page.locator('input[name="name"]')).toBeDisabled();
    await expect(page.getByRole('button', { name: /Save/ })).toHaveCount(0);

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

    await page.goto(`/tasks/${taskId}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit Task' })).toBeVisible();
    await expect(page.locator('input[name="title"]')).toBeEnabled();
  });
});
