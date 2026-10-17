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
 * Report incident wizard: fill step 1 (Basics) for an afternoon in-home support shift, advance to Incident details, fill it,
 * and select the left forearm on the body map with an injury type and description. With { addInjury: true } the injury
 * is also added to the recorded list. Fictional sample text only; participant and staff come from the mock API.
 */
export async function driveIncidentToDetails(page, goto, { addInjury = false } = {}) {
  await goto('/incidents/new')
  await page.getByLabel(labelRe('Title')).first().fill('Fall in the kitchen during an afternoon shift')
  await pick(page, 'Involved Participant', 'Sienna Whitfield')
  await pick(page, 'Reported By', 'Priya Nadarajah')
  await pick(page, 'Service Type', 'In-Home Support')
  await pick(page, 'Incident Type', 'Injury')
  await pick(page, 'Severity', 'Low')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('heading', { name: /Incident details/i }).first().waitFor()
  await page.getByLabel(labelRe('Date')).first().fill('2026-10-15T15:30')
  await page.getByLabel(labelRe('Location')).first().fill("Sienna's kitchen")
  await page.getByLabel(labelRe('Description')).first().fill('Sienna slipped on a wet patch of the kitchen floor while making afternoon tea and grazed her left forearm.')
  await page.getByLabel(labelRe('Immediate Actions')).first().fill('Floor dried. Graze cleaned and dressed by the support worker; Sienna rested and was settled within 20 minutes. Coordinator informed.')
  await page.getByRole('button', { name: 'Left Forearm', exact: false }).first().click()
  await pick(page, 'Injury type', 'Abrasion')
  await page.getByLabel(labelRe('Injury Description')).first().fill('Small graze on the left forearm, cleaned and dressed.')
  if (addInjury) {
    await page.getByRole('button', { name: 'Add injury' }).click()
    await page.getByRole('cell', { name: 'Small graze on the left forearm, cleaned and dressed.' }).waitFor()
  }
}
