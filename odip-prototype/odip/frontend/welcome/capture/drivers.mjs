/**
 * Shared UI drivers for the shot modules: small helpers that drive the REAL app the way a user would
 * (type into fields, open a dropdown and pick an option). Nothing here edits the DOM.
 */

/** Label matcher that anchors at the start ("Trip" must not match "Involved ... trip"). */
export const labelRe = (label) => new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'i')

/** Open a custom Dropdown / SearchableSelect by its label and choose an option by visible text. */
export async function pick(page, label, option) {
  const trigger = page.getByLabel(labelRe(label)).first()
  await trigger.click()
  await page.getByRole('option', { name: option }).first().click()
}

/**
 * Report New Incident wizard: fill step 1 (Basics) with the mock's Byron Bay graze scenario, advance to step 2
 * (Incident Details), fill it, and select the left forearm on the body map with an injury type and description.
 * With { addInjury: true } the injury is also added to the recorded list.
 * Fictional sample text only; participant, staff and trip come from the mock API.
 */
export async function driveIncidentToDetails(page, goto, { addInjury = false } = {}) {
  await goto('/incidents/new')
  await page.getByLabel(labelRe('Title')).first().fill('Minor graze from beach walk slip')
  await pick(page, 'Involved Participant', 'Liam Okafor')
  await pick(page, 'Reported By', 'Priya Nadarajah')
  await pick(page, 'Service Type', 'Trip')
  await pick(page, 'Trip', 'Byron Bay Winter Weekender')
  await pick(page, 'Incident Type', 'Injury')
  await pick(page, 'Severity', 'Low')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('heading', { name: 'Incident Details' }).first().waitFor()
  await page.getByLabel(labelRe('Date')).first().fill('2026-07-11T10:30')
  await page.getByLabel(labelRe('Location')).first().fill('Byron Bay beach boardwalk')
  await page.getByLabel(labelRe('Description')).first().fill('Liam slipped on wet boardwalk timber during the afternoon beach walk and grazed his left forearm.')
  await page.getByLabel(labelRe('Immediate Actions')).first().fill('Graze cleaned and dressed on site by the support worker. Liam settled and finished the walk. Coordinator informed.')
  await page.getByRole('button', { name: 'Left Forearm', exact: false }).first().click()
  await pick(page, 'Injury type', 'Abrasion')
  await page.getByLabel(labelRe('Injury Description')).first().fill('Small graze, cleaned and dressed on site.')
  if (addInjury) {
    await page.getByRole('button', { name: 'Add injury' }).click()
    await page.getByRole('cell', { name: 'Small graze, cleaned and dressed on site.' }).waitFor()
  }
}
