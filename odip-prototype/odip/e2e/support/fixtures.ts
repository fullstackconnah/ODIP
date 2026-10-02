import { test as base, expect, Page } from '@playwright/test';
import { call, login, Session } from './api';
import { DEMO_TENANT_ID, SEEDED } from './env';

type Options = { role: string };
type Fixtures = { session: Session; page: Page };

/**
 * Signs in by API and injects the three localStorage keys the app reads, before any page script runs.
 * Option `role` is a dev-login username (default: the seeded Coordinator).
 */
export const test = base.extend<Options & Fixtures>({
  role: [SEEDED.coordinator, { option: true }],
  session: async ({ role }, use) => {
    await use(await login(role));
  },
  page: async ({ page, session }, use) => {
    await page.addInitScript(([token, user, tenant]) => {
      localStorage.setItem('odip_token', token);
      localStorage.setItem('odip_user', user);
      localStorage.setItem('odip_viewing_tenant', tenant);
    }, [session.token, JSON.stringify(session.user), session.tenantId ?? DEMO_TENANT_ID] as const);

    const problems: string[] = [];
    page.on('console', m => {
      if (m.text().includes('Content Security Policy')) problems.push(`CSP violation: ${m.text()}`);
    });
    page.on('pageerror', e => problems.push(`uncaught page error: ${e.message}`));
    await use(page);
    expect(problems, 'CSP violations or uncaught page errors').toEqual([]);
  },
});

export { expect, call };
