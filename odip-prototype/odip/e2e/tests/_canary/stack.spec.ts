import { test, expect } from '@playwright/test';
import { call, expectStatus, login } from '../../support/api';
import { API_URL, API_V1, DEMO_TENANT_ID, EXPECTED_ROLE, SEEDED } from '../../support/env';
import { addDays, nextWednesday, sydneyToday } from '../../support/dates';
import {
  assignShift, makeBooking, makeParticipant, makeShift, makeStaff, makeTrip, publishShift,
} from '../../support/data';

// Stack canary: proves the CI stack (API + PostgreSQL + dev sign-in) is wired the way every journey assumes.
// Written to fail loudly when the readiness gate refuses writes (the three production breakages).
test.describe('stack canary', () => {
  test('health: live and ready @smoke', async () => {
    expect((await fetch(`${API_URL}/api/health/live`)).status).toBe(200);
    expect((await fetch(`${API_URL}/api/health/ready`)).status).toBe(200);
  });

  test('dev-users lists the seeded identities', async () => {
    const res = await fetch(`${API_V1}/auth/dev-users`);
    expect(res.status).toBe(200);
    const users: { username: string; role: string }[] = (await res.json()).data;
    for (const [username, role] of Object.entries(EXPECTED_ROLE)) {
      expect(users.find(u => u.username === username)?.role, username).toBe(role);
    }
    expect(users.filter(u => u.role === 'SupportWorker').length).toBeGreaterThanOrEqual(8);
  });

  for (const [username, role] of Object.entries(EXPECTED_ROLE)) {
    test(`dev-login as ${username} returns role ${role}`, async () => {
      const s = await login(username);
      expect(s.role).toBe(role);
      expect(s.token.split('.')).toHaveLength(3);
      if (role === 'SuperAdmin') expect(s.tenantId).toBeNull();
      else expect(s.tenantId).toBe(DEMO_TENANT_ID);
    });
  }

  test('provider settings leave readiness in Warn mode', async () => {
    const coord = await login(SEEDED.coordinator);
    const res = await expectStatus('provider-settings', 200, await call(coord, 'GET', '/provider-settings'));
    const mode = res.data?.participantReadinessMode;
    expect(mode === undefined || mode === null || mode === 'Warn', `readiness mode was ${mode}`).toBe(true);
  });

  test('write paths that broke production succeed in Warn mode @smoke', async () => {
    const coord = await login(SEEDED.coordinator);

    // 1. Activate a participant (intake, then profile completion).
    const participant = await makeParticipant(coord);
    expect(participant.isActive).toBe(true);

    // 2. Book it on a fresh trip.
    const trip = await makeTrip(coord, addDays(sydneyToday(), 21));
    const booking = await makeBooking(coord, trip.id, participant.id);
    expect(booking.data.id).toBeTruthy();
    const dup = await call(coord, 'POST', '/bookings', { tripInstanceId: trip.id, participantId: participant.id });
    expect(dup.status).toBe(409);

    // 3. Create a roster shift, assign a worker and publish it.
    const staff = await makeStaff(coord);
    const day = nextWednesday();
    const shift = await makeShift(coord, participant.id, day);
    expect(shift.status).toBe('Draft');
    const assigned = await assignShift(coord, shift.id, staff.id);
    expect(assigned.data.findings ?? []).toEqual([]);
    const published = await publishShift(coord, shift.id, participant.id, day);
    expect(published.data.status).toBe('Published');
  });
});
