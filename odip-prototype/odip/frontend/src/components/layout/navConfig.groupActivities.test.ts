import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { resolveNav, navItems, type NavAccess } from './navConfig'
import { usePermissions } from '@/lib/permissions'
import type { ModuleVisibilityDto } from '@/api/types'

function accessFor(role: string): NavAccess {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
  return renderHook(() => usePermissions()).result.current
}

const base: ModuleVisibilityDto = { hiddenAccommodation: false, hiddenVehicles: false, hiddenTrips: false }
const labels = (visibility?: ModuleVisibilityDto) =>
  resolveNav(navItems, accessFor('Coordinator'), visibility).flatMap(e => (e.kind === 'group' ? e.children.map(c => c.label) : [e.leaf.label]))

afterEach(() => localStorage.clear())

describe('navConfig: Group activities', () => {
  it('sits right after Roster board, and only while the switch is on', () => {
    const on = labels({ ...base, groupActivitiesEnabled: true })
    expect(on[on.indexOf('Roster board') + 1]).toBe('Group activities')
    expect(labels({ ...base, groupActivitiesEnabled: false })).not.toContain('Group activities')
    expect(labels()).not.toContain('Group activities')
  })
})
