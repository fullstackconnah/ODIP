import { call, login } from './support/api';
import { API_URL, API_V1, EXPECTED_ROLE, SEEDED } from './support/env';

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${API_URL}/api/health/ready`);
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = String(e);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`global-setup: API not ready at ${API_URL} after 60 s (${last})`);
}

export default async function globalSetup(): Promise<void> {
  await waitReady();

  const users = await fetch(`${API_V1}/auth/dev-users`);
  if (users.status === 404) {
    throw new Error('global-setup: /auth/dev-users is 404, so the API was not started with DEV_AUTH_ENABLED=true');
  }
  const list: { username: string }[] = (await users.json()).data ?? [];
  const names = new Set(list.map(u => u.username));
  for (const u of Object.keys(EXPECTED_ROLE)) {
    if (!names.has(u)) throw new Error(`global-setup: seeded user "${u}" missing from dev-users (did the seed run?)`);
  }

  const coord = await login(SEEDED.coordinator);
  const ps = await call(coord, 'GET', '/provider-settings');
  const mode = ps.data?.participantReadinessMode;
  if (mode && mode !== 'Warn') {
    throw new Error(`global-setup: organisation is in ${mode} mode: rostering, bookings and activation will be refused`);
  }
}
