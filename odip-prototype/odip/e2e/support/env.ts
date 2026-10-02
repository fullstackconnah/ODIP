export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8475';
export const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:5000';
export const API_V1 = `${API_URL}/api/v1`;

/** Tenant id of the seeded Demo organisation (DbSeeder). SuperAdmin calls need it as X-View-As-Tenant. */
export const DEMO_TENANT_ID = 'b0000000-0000-0000-0000-000000000001';

/** One seeded login per role the canary exercises. */
export const SEEDED = {
  coordinator: 'sarah.mitchell',
  supportWorker: 'james.obrien',
  readOnly: 'coordinator.read',
  superAdmin: 'admin',
} as const;

export const EXPECTED_ROLE: Record<string, string> = {
  [SEEDED.coordinator]: 'Coordinator',
  [SEEDED.supportWorker]: 'SupportWorker',
  [SEEDED.readOnly]: 'ReadOnly',
  [SEEDED.superAdmin]: 'SuperAdmin',
};
