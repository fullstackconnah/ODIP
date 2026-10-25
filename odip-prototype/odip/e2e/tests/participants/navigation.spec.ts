import { Page } from '@playwright/test';
import { test, expect, call } from '../../support/fixtures';
import { expectStatus, login } from '../../support/api';
import { SEEDED } from '../../support/env';
import { makeParticipant, uniqueToken, type Created } from '../../support/data';
import { sydneyToday } from '../../support/dates';

// NAV (owner report 2026-10-13): a row opens its record, Back returns where the user came from (else to the list the participant is on),
// and Cancel returns to where Edit was clicked. One participant per stage, each with a unique token.

let active: Created;
let onboarding: Created;
let draft: Created;
let enquiry: Created;
let medication: { id: string; name: string };

test.beforeAll(async () => {
  const coord = await login(SEEDED.coordinator);
  active = await makeParticipant(coord);
  // Intake complete, profile not: a draft on the Onboarding tab.
  const onb = uniqueToken();
  const o = await expectStatus('create onboarding participant', 201, await call(coord, 'POST', '/participants', {
    firstName: 'Ob', lastName: onb, isDraft: true, completeIntake: true,
  }));
  onboarding = { ...o.data, id: o.data.id, token: onb };
  // Intake saved as a draft: a Draft intake row on the Enquiries tab.
  const dr = uniqueToken();
  const d = await expectStatus('create draft intake', 201, await call(coord, 'POST', '/participants', {
    firstName: 'Dr', lastName: dr, isDraft: true, completeIntake: false,
  }));
  draft = { ...d.data, id: d.data.id, token: dr };
  // An enquiry not yet converted: a New row on the Enquiries tab.
  const en = uniqueToken();
  const e = await expectStatus('create enquiry', [200, 201], await call(coord, 'POST', '/inquiries', {
    firstName: 'En', lastName: en, source: 'Phone', phone: '0400000000',
  }));
  enquiry = { ...e.data, id: e.data.id, token: en };
  const medName = `Med ${active.token}`;
  const med = await expectStatus('create medication', [200, 201], await call(coord, 'POST', `/participants/${active.id}/medications`, {
    name: medName, doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', type: 'Regular',
    timesOfDay: '08:00', startDate: `${sydneyToday()}T00:00:00`, consentObtained: true,
  }));
  medication = { id: med.data.id, name: medName };
});

/** The one row holding `token` on the hub tab now shown, found through that tab's own search. */
async function hubRow(page: Page, search: string, token: string) {
  await page.getByPlaceholder(search).fill(token);
  const row = page.getByRole('row').filter({ hasText: token });
  await expect(row).toHaveCount(1);
  return row;
}

const back = (page: Page) => page.getByRole('link', { name: /^Back to / });
const ACTIVE_SEARCH = 'Search participants...';
const ONBOARDING_SEARCH = 'Search participants or what is still to do...';
const ENQUIRIES_SEARCH = 'Search enquiries...';

test.describe('participant workflow navigation', () => {
  test('a row click on each hub tab opens that row, at the target of its own button', async ({ page }) => {
    await page.goto('/participants');
    // A cell with no control in it: the row itself takes the click.
    await (await hubRow(page, ACTIVE_SEARCH, active.token)).getByRole('cell').nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/participants/${active.id}$`));

    await page.goto('/participants?tab=onboarding');
    await (await hubRow(page, ONBOARDING_SEARCH, onboarding.token)).getByRole('cell').nth(2).click();
    await expect(page).toHaveURL(new RegExp(`/onboarding/${onboarding.id}$`));

    await page.goto('/participants?tab=enquiries');
    await (await hubRow(page, ENQUIRIES_SEARCH, enquiry.token)).getByRole('cell').nth(2).click();
    await expect(page).toHaveURL((url) => url.pathname === '/participants/new-inquiry' && url.searchParams.get('id') === enquiry.id);

    await page.goto('/participants?tab=enquiries');
    await (await hubRow(page, ENQUIRIES_SEARCH, draft.token)).getByRole('cell').nth(2).click();
    await expect(page).toHaveURL(new RegExp(`/participants/${draft.id}/intake$`));
  });

  test('Back from a participant returns to the hub tab they came from, or to the tab their stage is listed on', async ({ page }) => {
    // Active: by history, from the row.
    await page.goto('/participants');
    await (await hubRow(page, ACTIVE_SEARCH, active.token)).getByRole('cell').nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/participants/${active.id}$`));
    await back(page).click();
    await expect(page).toHaveURL((url) => url.pathname === '/participants' && url.search === '');

    // Onboarding: by history through the checklist, then the checklist's own Back.
    await page.goto('/participants?tab=onboarding');
    await (await hubRow(page, ONBOARDING_SEARCH, onboarding.token)).getByRole('cell').nth(2).click();
    await page.getByRole('link', { name: 'View record' }).click();
    await expect(page).toHaveURL(new RegExp(`/participants/${onboarding.id}$`));
    await back(page).click();
    await expect(page).toHaveURL(new RegExp(`/onboarding/${onboarding.id}$`));
    await back(page).click();
    await expect(page).toHaveURL((url) => url.pathname === '/participants' && url.searchParams.get('tab') === 'onboarding');

    // Enquiries: the Draft intake row opens the intake, whose Back returns to the tab.
    await page.goto('/participants?tab=enquiries');
    await (await hubRow(page, ENQUIRIES_SEARCH, draft.token)).getByRole('cell').nth(2).click();
    await expect(page).toHaveURL(new RegExp(`/participants/${draft.id}/intake$`));
    await page.getByTestId('intake-header-back').click();
    await expect(page).toHaveURL((url) => url.pathname === '/participants' && url.searchParams.get('tab') === 'enquiries');

    // With no history (a deep link), the stage decides: a draft intake is on Enquiries, an intake-complete draft on Onboarding.
    await page.goto(`/participants/${draft.id}`);
    await back(page).click();
    await expect(page).toHaveURL((url) => url.pathname === '/participants' && url.searchParams.get('tab') === 'enquiries');
    await page.goto(`/participants/${onboarding.id}`);
    await back(page).click();
    await expect(page).toHaveURL((url) => url.pathname === '/participants' && url.searchParams.get('tab') === 'onboarding');
  });

  test('Edit from the Funding & claims tab, then Cancel, returns to Funding & claims', async ({ page }) => {
    await page.goto(`/participants/${active.id}?tab=funding`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('option', { name: 'Edit full profile (wizard)' }).click();
    await expect(page).toHaveURL(new RegExp(`/participants/${active.id}/profile$`));
    await page.getByRole('link', { name: 'Cancel' }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/participants/${active.id}` && url.searchParams.get('tab') === 'funding');
    await expect(page.getByRole('tab', { name: /Funding/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('onboarding checklist, Edit profile, Cancel returns to the checklist', async ({ page }) => {
    await page.goto(`/onboarding/${onboarding.id}`);
    await page.getByRole('link', { name: 'Edit profile' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/participants/${onboarding.id}/profile\\?from=onboarding$`));
    await page.getByRole('link', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(new RegExp(`/onboarding/${onboarding.id}$`));
  });

  test('the medication form opened from the register returns to the register', async ({ page }) => {
    await page.goto('/medications?tab=register');
    await page.getByPlaceholder('Search medications or participants...').fill(medication.name);
    const row = page.getByRole('row').filter({ hasText: medication.name });
    await expect(row).toHaveCount(1);
    await row.getByRole('cell').first().click();
    await expect(page).toHaveURL(new RegExp(`/medications/${medication.id}/edit$`));
    await expect(back(page)).toHaveAttribute('href', '/medications?tab=register');
    await page.getByRole('link', { name: 'Cancel' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/medications' && url.searchParams.get('tab') === 'register');
    await expect(page.getByRole('tab', { name: /Register/ })).toHaveAttribute('aria-selected', 'true');
  });
});
