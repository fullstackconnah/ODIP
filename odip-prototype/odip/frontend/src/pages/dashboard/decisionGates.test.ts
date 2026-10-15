import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermissions } from '@/lib/permissions'
import { decisionGates } from './decisionGates'

const gatesFor = (role: string, viewingOrganisation = false) => {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
  return decisionGates(renderHook(() => usePermissions()).result.current, viewingOrganisation)
}
const ALL = { completions: true, leave: true, incidents: true, tasks: true, compliance: true, needsOrganisation: false }
const NONE = { completions: false, leave: false, incidents: false, tasks: false, compliance: false, needsOrganisation: false }

afterEach(() => localStorage.clear())

describe('decisionGates: the server gates, per viewer (SHAPE §3)', () => {
  it('gives an Admin and a Coordinator every PR A group', () => {
    expect(gatesFor('Admin')).toEqual(ALL)
    expect(gatesFor('Coordinator')).toEqual(ALL)
  })

  it('gives a SuperAdmin the groups only inside an organisation, and otherwise the line asking for one', () => {
    expect(gatesFor('SuperAdmin', true)).toEqual(ALL)
    expect(gatesFor('SuperAdmin', false)).toEqual({ ...NONE, needsOrganisation: true })
  })

  it('gives ReadOnly and a SupportWorker no group at all', () => {
    expect(gatesFor('ReadOnly')).toEqual(NONE)
    expect(gatesFor('SupportWorker')).toEqual(NONE)
  })
})
