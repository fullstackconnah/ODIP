/**
 * Stage 4: CARE shots that live outside shots.mjs (shift detail on a phone). Same shape as shots.mjs.
 */
export const shots = []

/** Card (bordered box) that contains the given text, found from its heading. */
const cardOf = (page, headingText) =>
  page.getByText(headingText, { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"rounded")][1]')

/** Full phone width (x 0..390), from 12px above the first locator to 12px below the last. */
async function phoneRect(unionRect, first, last) {
  const a = await unionRect([first])
  const b = await unionRect([last])
  return { x: 0, y: a.y - 12, width: 390, height: b.y + b.height + 12 - (a.y - 12) }
}

const common = {
  stage: 'care',
  priority: 'P2',
  route: '/portal/shifts/shift-0003',
  fixture: false,
  now: '2026-09-13T08:30:00+10:00',
  mobile: true,
}

async function openShift(page, goto, settle) {
  await goto('/portal/shifts/shift-0003')
  await page.getByText('Sienna bumped her arm').first().waitFor()
  await settle()
}

shots.push({
  ...common,
  name: 'care-shift-detail-phone',
  cropTarget: 'Shift detail on a phone: participant and time range, the Start shift action and the participant summary card; back link, lower cards and bottom nav excluded',
  alt: 'Shift detail on a phone for Sienna Whitfield, Sunday 13 September 9am to 3pm, Published, with a Start shift button and a participant summary card showing support ratio, overnight support, wheelchair mobility, equipment, transport and medical notes.',
  notes: 'Mock data, no fixtures (the mock serves portal shift shift-0003). Clock pinned to the morning of the shift. iPhone-sized viewport 390x844 shot at 3x and downscaled. The page continues below with routines, risks, medications and shift notes (see care-shift-notes-phone).',
  async run({ page, goto, settle, unionRect }) {
    await openShift(page, goto, settle)
    return { rect: await phoneRect(unionRect, page.getByRole('heading', { level: 1 }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), cardOf(page, 'Participant summary')) }
  },
})

shots.push({
  ...common,
  name: 'care-shift-notes-phone',
  cropTarget: 'Shift notes card on a phone: a note flagged for an injury keyword with the Dismiss / File incident report prompt, and the Add a note box',
  alt: 'Shift notes card on a phone: a note by Tom Beattie saying Sienna bumped her arm transferring into the WAV, with a yellow prompt that the note mentions injury, asking to consider filing an incident report, with Dismiss and File incident report buttons above an empty Add a note box.',
  notes: 'Mock data, no fixtures (the mock serves the shift notes for shift-0003, one flagged Injury). Same phone setup as care-shift-detail-phone. The notes card sits at the bottom of the shift page, so it is a separate crop.',
  async run({ page, goto, settle, unionRect }) {
    await openShift(page, goto, settle)
    const card = cardOf(page, 'Shift notes')
    return { rect: await phoneRect(unionRect, card, card) }
  },
})
