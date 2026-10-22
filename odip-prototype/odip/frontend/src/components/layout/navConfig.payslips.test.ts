import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { barEntries, isLeafActive, isWorkspaceHidden, navLeaves, resolveNav, navItems, type NavAccess } from './navConfig'
import { usePermissions } from '@/lib/permissions'
import type { ModuleVisibilityDto } from '@/api/types'

/** What a real session of this role is allowed: the same permissions the shell reads. */
function accessFor(role: string | null): NavAccess {
  if (role) localStorage.setItem('odip_user', JSON.stringify({ role }))
  return renderHook(() => usePermissions()).result.current
}

/** A menu as "label" / "label: child | child" strings, for readable assertions. */
const shape = (entries: ReturnType<typeof resolveNav>) =>
  entries.map(entry => (entry.kind === 'group' ? `${entry.group.label}: ${entry.children.map(child => child.label).join(' | ')}` : entry.leaf.label))

const connected: ModuleVisibilityDto = { hiddenAccommodation: false, hiddenVehicles: false, employmentHeroConnected: true }
const notConnected: ModuleVisibilityDto = { hiddenAccommodation: false, hiddenVehicles: false, employmentHeroConnected: false }
const leaf = (to: string) => navLeaves.find(candidate => candidate.to === to)!

afterEach(() => localStorage.clear())

describe('navConfig — My payslips', () => {
  it('shows My payslips right after My shifts only when the organisation is connected', () => {
    expect(shape(resolveNav(navItems, accessFor('SupportWorker'), connected))).toEqual([
      'My shifts', 'My payslips', 'Trips: Trips | Schedule | Tasks', 'Participants: Participants | Medications', 'Incidents',
    ])
    expect(shape(resolveNav(navItems, accessFor('SupportWorker'), notConnected))).toEqual([
      'My shifts', 'Trips: Trips | Schedule | Tasks', 'Participants: Participants | Medications', 'Incidents',
    ])
    expect(shape(resolveNav(navItems, accessFor('SupportWorker')))).not.toContain('My payslips')
    for (const role of ['Admin', 'ReadOnly']) {
      const labels = shape(resolveNav(navItems, accessFor(role), connected))
      expect(labels[labels.indexOf('My shifts') + 1], role).toBe('My payslips')
    }
  })

  it('hides My payslips from a SuperAdmin even when connected', () => {
    expect(shape(resolveNav(navItems, accessFor('SuperAdmin'), connected))).not.toContain('My payslips')
  })

  it('never puts My payslips in the bottom bar', () => {
    const labels = (visibility: ModuleVisibilityDto) =>
      (['office', 'field'] as const).map(audience => barEntries(resolveNav(navItems, accessFor('Admin'), visibility), audience).map(entry => (entry.kind === 'group' ? entry.group.label : entry.leaf.label)))
    expect(labels(connected)).toEqual(labels(notConnected))
    expect(labels(connected).flat()).not.toContain('My payslips')
  })

  it('does not list My payslips as a hidden workspace', () => {
    expect(isWorkspaceHidden(leaf('/portal/payslips'), notConnected)).toBe(false)
  })

  it('keeps My shifts lit on its own pages but not on My payslips', () => {
    const myShifts = leaf('/portal')
    for (const path of ['/portal', '/portal/shifts/abc', '/portal/leave', '/portal/witness-approvals']) expect(isLeafActive(myShifts, path), path).toBe(true)
    expect(isLeafActive(myShifts, '/portal/payslips')).toBe(false)
    expect(isLeafActive(leaf('/portal/payslips'), '/portal/payslips')).toBe(true)
  })
})
