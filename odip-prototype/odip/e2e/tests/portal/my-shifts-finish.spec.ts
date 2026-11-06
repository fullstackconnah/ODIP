import type { Page } from '@playwright/test'
import { test, expect, call } from '../../support/fixtures'
import { expectStatus, login } from '../../support/api'
import { makeParticipant, makeStaff, shiftBody, uniqueToken } from '../../support/data'
import { sydneyToday } from '../../support/dates'
import { DEMO_TENANT_ID, SEEDED } from '../../support/env'

// The My shifts redesign (spec 2026-10-14), end to end on the real API and PostgreSQL at 390 px with touch: a worker opens the shift from the
// list's current card, ends it with the details on one page (moving the start 10 minutes earlier with a reason, and 12.5 km), and the coordinator's
// completion carries the stamp it replaced, the reason, the kilometres and the "No" answer.
// Sydney, as the e2e config pins: the card's query and today's date come from the browser clock (plan check S2).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Australia/Sydney' })

/** Waits until no animation or transition is running, so a capture is not taken mid-fade (as participant-import.spec.ts does). */
const settled = (p: Page) => p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'))

test('a support worker ends a shift and adds the details on one page on a phone, and the coordinator sees the moved start, reason and kilometres @portal', async ({ page, session }, testInfo) => {
  test.setTimeout(150_000)
  const participant = await makeParticipant(session, uniqueToken('MSF'))
  const staff = await makeStaff(session, uniqueToken('MSW'))
  // The staff DTO carries the derived username. If a build's create response lacks it, use the seeded worker: the unique participant keeps the shift apart.
  const worker = await login(typeof staff.username === 'string' ? staff.username : SEEDED.supportWorker)
  const workerId = worker.user.id as string
  const today = sydneyToday()
  const times = { startTime: '00:01:00', endTime: '23:59:00' }
  const shift = await expectStatus('create shift', 200, await call(session, 'POST', '/rostering/shifts', shiftBody(participant.id, today, times)))
  const shiftId = shift.data.id as string
  await expectStatus('assign', 200, await call(session, 'POST', `/rostering/shifts/${shiftId}/assign`, { staffId: workerId }))
  await expectStatus('publish', 200, await call(session, 'PUT', `/rostering/shifts/${shiftId}`, shiftBody(participant.id, today, { ...times, staffId: workerId, status: 'Published' })))   // staffId again: the PUT body is the whole shift
  await expectStatus('start', 200, await call(worker, 'POST', `/portal/shifts/${shiftId}/start`, { geolocationDeclined: true }))

  // The fixture signed the page in as the coordinator; a later init script runs after it, so the page is the worker's.
  await page.addInitScript(([token, user, tenant]) => {
    localStorage.setItem('odip_token', token)
    localStorage.setItem('odip_user', user)
    localStorage.setItem('odip_viewing_tenant', tenant)
  }, [worker.token, JSON.stringify(worker.user), worker.tenantId ?? DEMO_TENANT_ID] as const)
  const shot = (name: string) => settled(page).then(() => page.screenshot({ path: testInfo.outputPath(`${name}-390.png`), fullPage: true }))
  await page.emulateMedia({ reducedMotion: 'reduce' })


  // The list leads with the shift in progress.
  await page.goto('/portal')
  await expect(page.getByText(/^On shift now/)).toBeVisible()
  await shot('e2e-01-list')
  await page.getByRole('link', { name: 'Continue shift' }).tap()
  await expect(page.getByRole('tablist', { name: 'Shift' })).toBeVisible()
  await page.getByRole('toolbar', { name: 'Shift actions' }).getByRole('button', { name: 'End shift' }).tap()

  // End shift takes the end at the tap and opens the details page. The START moves 10 minutes before its stamp, with a reason (a moved finish
  // would fall before the start, as the shift was started seconds ago); the finish-move case is the vitest's.
  await expect(page.getByRole('heading', { level: 2, name: /^Ended / })).toBeVisible()
  await page.getByRole('button', { name: 'Change your start time' }).tap()
  const start = page.getByLabel('Your start time')
  const stamp = await start.inputValue()   // the control opens on the stamp's minute
  // Wall-clock arithmetic on the control's own digits: read as UTC only to subtract, so the zone never enters it.
  const tenEarlier = new Date(Date.parse(`${stamp}:00Z`) - 10 * 60_000).toISOString().slice(0, 16)
  await start.fill(tenEarlier)
  await page.getByLabel('Why did your times change?').fill('Arrived early to help with breakfast.')
  await page.getByLabel(/Kilometres driven with/).fill('12.5')
  // Travel legs appear only when the organisation asks for them: answer each with No trip.
  for (const box of await page.getByRole('checkbox', { name: 'No trip' }).all()) await box.check()
  await page.getByRole('checkbox', { name: 'Nothing to note' }).check()
  await page.getByLabel('Your handover note').fill('All settled. Bedtime at eight.')
  await page.getByRole('button', { name: 'No, nothing to report' }).tap()
  await shot('e2e-02-details')
  const bar = page.getByRole('toolbar', { name: 'Shift actions' })
  await expect(bar.getByRole('button', { name: 'Add details later' })).toHaveCount(0)   // everything is answered
  await bar.getByRole('button', { name: 'Submit shift' }).tap()
  await expect(page.getByText('Shift submitted', { exact: true })).toBeFocused()
  await shot('e2e-03-submitted')

  // Stored, as the coordinator sees it.
  const stored = await expectStatus('completion', 200, await call(session, 'GET', `/rostering/shifts/${shiftId}/completion`))
  expect(stored.data).toMatchObject({
    timesAdjusted: true, timeAdjustmentReason: 'Arrived early to help with breakfast.', kilometres: 12.5, anythingToReport: false,
    nothingToNoteConfirmed: true, handoverText: 'All settled. Bedtime at eight.',
  })
  expect(stored.data.originalActualStart).not.toBeNull()
  expect(stored.data.originalActualEnd).toBeNull()
  expect(Date.parse(stored.data.actualStart)).toBeLessThan(Date.parse(stored.data.originalActualStart))
})
