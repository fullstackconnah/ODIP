import { test, expect, call } from '../../support/fixtures'
import { expectStatus, login } from '../../support/api'
import { makeParticipant, makeStaff, shiftBody, uniqueToken } from '../../support/data'
import { sydneyToday } from '../../support/dates'
import { DEMO_TENANT_ID, SEEDED } from '../../support/env'

// PWA PR3 end to end on the real API: a worker opens a shift online (it is saved on the phone), loses signal, starts the shift and writes a note,
// sees both waiting, and when the connection returns Send now delivers them to the server.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Australia/Sydney' })

test('a worker starts a shift and writes a note offline, and both reach the server when back online @pwa', async ({ page, context, session }) => {
  test.setTimeout(150_000)
  const participant = await makeParticipant(session, uniqueToken('OFP'))
  const staff = await makeStaff(session, uniqueToken('OFW'))
  const worker = await login(typeof staff.username === 'string' ? staff.username : SEEDED.supportWorker)
  const workerId = worker.user.id as string
  const today = sydneyToday()
  const times = { startTime: '00:01:00', endTime: '23:59:00' }
  const shift = await expectStatus('create shift', 200, await call(session, 'POST', '/rostering/shifts', shiftBody(participant.id, today, times)))
  const shiftId = shift.data.id as string
  await expectStatus('assign', 200, await call(session, 'POST', `/rostering/shifts/${shiftId}/assign`, { staffId: workerId }))
  await expectStatus('publish', 200, await call(session, 'PUT', `/rostering/shifts/${shiftId}`, shiftBody(participant.id, today, { ...times, staffId: workerId, status: 'Published' })))

  await page.addInitScript(([token, user, tenant]) => {
    localStorage.setItem('odip_token', token)
    localStorage.setItem('odip_user', user)
    localStorage.setItem('odip_viewing_tenant', tenant)
  }, [worker.token, JSON.stringify(worker.user), worker.tenantId ?? DEMO_TENANT_ID] as const)

  await page.goto(`/portal/shifts/${shiftId}`)
  const bar = page.getByRole('toolbar', { name: 'Shift actions' })
  await expect(bar.getByRole('button', { name: 'Start shift' })).toBeVisible()

  await context.setOffline(true)
  await bar.getByRole('button', { name: 'Start shift' }).tap()
  await page.getByRole('tab', { name: /Notes/ }).tap()
  await page.getByLabel('Add a note').fill('Written without signal.')
  await page.getByRole('button', { name: 'Add note' }).tap()
  await expect(page.getByRole('status').filter({ hasText: /waiting to send/ })).toContainText('2 changes waiting to send')

  await context.setOffline(false)
  // Coming back online replays on its own; Send now is the fallback if the row is still showing it.
  await page.getByRole('button', { name: 'Send now' }).first().tap({ timeout: 3_000 }).catch(() => {})
  await expect(page.getByRole('status').filter({ hasText: /waiting to send/ })).toHaveCount(0, { timeout: 20_000 })

  const notes = await expectStatus('notes', 200, await call(worker, 'GET', `/portal/shifts/${shiftId}/notes`))
  expect(JSON.stringify(notes.data)).toContain('Written without signal.')
  const detail = await expectStatus('detail', 200, await call(worker, 'GET', `/portal/shifts/${shiftId}`))
  expect(detail.data.status).toBe('InProgress')
})
