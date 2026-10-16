import { test, expect, call } from '../../support/fixtures';
import { expectStatus } from '../../support/api';

// Start intake after the enquiry redesign, end to end on the real API and PostgreSQL (spec 2026-10-16, L5, D1, D2): it waits for the full address,
// the reason links to the field that fixes it, and the main contact becomes the participant's first contact while their phone and email stay off
// the participant.
const token = `${(process.pid % 4096).toString(36)}${Date.now().toString(36).slice(-5)}`;

test("Start intake waits for the address, then makes the main contact the participant's first contact", async ({ page, session }) => {
  const created = await expectStatus('create an enquiry', 200, await call(session, 'POST', '/inquiries', {
    firstName: 'Ari', lastName: token, contactFirstName: 'Sarah', contactLastName: token, contactRelationship: 'Mother',
    email: `sarah.${token}@example.com`, phone: '0412 555 061', source: 'Phone',
  }));
  const id: string = created.data.id;
  let started = false;
  try {
    // 1. The button is there but held, with its reason linking to the address.
    await page.goto('/participants?tab=enquiries');
    await page.getByRole('textbox', { name: /search enquiries/i }).fill(token);
    const start = page.getByRole('button', { name: `Start intake for Ari ${token}` });
    await expect(start).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('link', { name: 'Add an address to start intake' }).click();
    await expect(page).toHaveURL(/focus=address/);
    await expect(page.locator('#inquiry-address-street')).toBeFocused();

    // 2. Add the address and save; Start intake is free.
    await page.locator('#inquiry-address-street').fill('12 Smith St');
    await page.locator('#inquiry-address-suburb').fill('Parramatta');
    await page.locator('#inquiry-address-state').selectOption('NSW');
    await page.locator('#inquiry-address-postcode').fill('2150');
    await page.getByRole('button', { name: 'Save enquiry' }).click();
    await expect(page).toHaveURL(/\/participants\?tab=enquiries/);
    await page.getByRole('textbox', { name: /search enquiries/i }).fill(token);
    await expect(start).not.toHaveAttribute('aria-disabled', 'true');
    await start.click();
    await expect(page).toHaveURL(/\/participants\/[0-9a-f-]+\/intake/);
    started = true;
    const pid = page.url().match(/\/participants\/([0-9a-f-]+)\/intake/)![1];

    // 3. The main contact is the participant's one contact: Next of Kin (no role was chosen, D2), primary. Their phone and email are not the participant's.
    const roles = await expectStatus('contact roles', 200, await call(session, 'GET', `/participants/${pid}/contact-roles`));
    expect(roles.data).toEqual([expect.objectContaining({
      personFullName: `Sarah ${token}`, personPhone: '0412 555 061', relationshipToParticipant: 'Mother', roleType: 'NextOfKin', isPrimary: true,
    })]);
    const participant = await expectStatus('the participant', 200, await call(session, 'GET', `/participants/${pid}`));
    expect(participant.data.phone ?? null).toBeNull();
    expect(participant.data.email ?? null).toBeNull();
    expect(participant.data.addressSuburb).toBe('Parramatta');
  } finally {
    // An enquiry whose intake has started can't be closed; one that never started is closed so a retry starts clean.
    if (!started) await call(session, 'POST', `/inquiries/${id}/close`, { outcome: 'Other' });
  }
});
