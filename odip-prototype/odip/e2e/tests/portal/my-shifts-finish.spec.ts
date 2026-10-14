import type { Page } from '@playwright/test'
import { test, expect, call } from '../../support/fixtures'
import { expectStatus, login } from '../../support/api'
import { makeParticipant, makeStaff, shiftBody, uniqueToken } from '../../support/data'
import { sydneyToday } from '../../support/dates'
import { DEMO_TENANT_ID, SEEDED } from '../../support/env'

// The My shifts redesign (spec 2026-10-14), end to end on the real API and PostgreSQL at 390 px with touch: a worker opens the shift from the
// list's current card, ends it through all five steps (moving the start 10 minutes earlier with a reason, and 12.5 km), and the coordinator's
// completion carries the stamp it replaced, the reason, the kilometres and the "No" answer.
// Sydney, as the e2e config pins: the card's query and today's date come from the browser clock (plan check S2).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Australia/Sydney' })

/** Waits until no animation or transition is running, so a capture is not taken mid-fade (as participant-import.spec.ts does). */
const settled = (p: Page) => p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'))

test('a support worker finishes a shift through all five steps on a phone, and the coordinator sees the moved start, reason and kilometres @portal', async ({ page, session }, testInfo) => {
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
  await expect(page.getByRole('heading', { name: 'On shift now' })).toBeVisible()
  await shot('e2e-01-list')
  await page.getByRole('link', { name: 'Continue shift' }).tap()
  await expect(page.getByRole('tablist', { name: 'Shift' })).toBeVisible()
  await page.getByRole('toolbar', { name: 'Shift actions' }).getByRole('button', { name: 'End shift' }).tap()

  // Step 1: the START 10 minutes before its stamp, with a reason and kilometres. The shift was started seconds ago, so a moved finish would fall
  // before the start (plan check M1); the finish-move case is Task 9's vitest.
  await expect(page.getByRole('heading', { level: 2, name: 'Your times' })).toBeFocused()
  await page.getByRole('button', { name: 'Change your start time' }).tap()
  const start = page.getByLabel('Your start time')
  const stamp = await start.inputValue()   // the control opens on the stamp's minute
  // Wall-clock arithmetic on the control's own digits: read as UTC only to subtract, so the zone never enters it.
  const tenEarlier = new Date(Date.parse(`${stamp}:00Z`) - 10 * 60_000).toISOString().slice(0, 16)
  await start.fill(tenEarlier)
  await page.getByLabel('Why did your times change?').fill('Arrived early to help with breakfast.')
  await page.getByLabel(/Kilometres driven with/).fill('12.5')
  await shot('e2e-02-times')
  const bar = page.getByRole('toolbar', { name: 'Shift actions' })
  await bar.getByRole('button', { name: 'Confirm times' }).tap()

  // Step 2: nothing due.
  await expect(page.getByText('Nothing due this shift.')).toBeVisible()
  await bar.getByRole('button', { name: 'Next' }).tap()
  // Step 3: no.
  await page.getByRole('button', { name: 'No, nothing to report' }).tap()
  // Step 4: a handover; the forward button says the note answer it gives.
  await page.getByLabel('Your handover note').fill('All settled. Bedtime at eight.')
  await bar.getByRole('button', { name: 'Nothing to note' }).tap()
  // Step 5: check, then submit.
  await expect(page.getByRole('heading', { level: 2, name: 'Check and submit' })).toBeFocused()
  await expect(page.getByText(/\(changed from \d{1,2}:\d{2}\s?[ap]m\)$/i)).toBeVisible()
  await expect(page.getByText('Arrived early to help with breakfast.')).toBeVisible()
  await expect(page.getByText('12.5 km')).toBeVisible()
  await shot('e2e-03-check')
  await bar.getByRole('button', { name: 'Submit shift' }).tap()
  await expect(page.getByText('Shift submitted', { exact: true })).toBeFocused()
  await shot('e2e-04-submitted')

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
