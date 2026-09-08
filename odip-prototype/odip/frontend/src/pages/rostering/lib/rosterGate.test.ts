import { describe, it, expect } from 'vitest'
import { getRosterGate } from './rosterGate'
import type { RosterFindingDto } from '@/api/types'

const warningRequiresReason: RosterFindingDto = {
  code: 'STAFF_ON_LEAVE',
  severity: 'Warning',
  message: 'Leave overlap',
  requiresReason: true,
}

const warningNoReason: RosterFindingDto = {
  code: 'STAFF_LEAVE_PENDING',
  severity: 'Warning',
  message: 'Leave request pending',
  requiresReason: false,
}

const blocking: RosterFindingDto = {
  code: 'WSC_EXPIRED',
  severity: 'Blocking',
  message: 'Worker screening expired.',
  requiresReason: false,
}

describe('getRosterGate', () => {
  it('returns empty arrays and both flags false for an empty findings list', () => {
    const gate = getRosterGate([])
    expect(gate.blockingFindings).toEqual([])
    expect(gate.reasonRequiredFindings).toEqual([])
    expect(gate.isBlocked).toBe(false)
    expect(gate.needsReason).toBe(false)
  })

  it('flags needsReason for a Warning with requiresReason, without blocking', () => {
    const gate = getRosterGate([warningRequiresReason])
    expect(gate.needsReason).toBe(true)
    expect(gate.isBlocked).toBe(false)
    expect(gate.reasonRequiredFindings).toEqual([warningRequiresReason])
  })

  it('flags isBlocked for a Blocking finding without requiresReason, without needing a reason', () => {
    const gate = getRosterGate([blocking])
    expect(gate.isBlocked).toBe(true)
    expect(gate.needsReason).toBe(false)
    expect(gate.blockingFindings).toEqual([blocking])
  })

  it('flags both for a mixed list, with each array holding exactly the matching findings', () => {
    const gate = getRosterGate([blocking, warningRequiresReason, warningNoReason])
    expect(gate.isBlocked).toBe(true)
    expect(gate.needsReason).toBe(true)
    expect(gate.blockingFindings).toEqual([blocking])
    expect(gate.reasonRequiredFindings).toEqual([warningRequiresReason])
  })
})
