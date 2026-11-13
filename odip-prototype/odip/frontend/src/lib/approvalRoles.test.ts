import { describe, expect, it } from 'vitest'
import { approvalRolesLine } from './approvalRoles'

describe('approvalRolesLine', () => {
  it('lists the roles that could approve and the role the approver acted in, with house labels', () => {
    expect(approvalRolesLine('Admin,Coordinator', 'Coordinator')).toBe('Roles that could approve at the time: Admin, Coordinator. Approved as: Coordinator.')
  })
  it('lists every role the approver acted in', () => {
    expect(approvalRolesLine('Admin', 'Admin,SuperAdmin')).toBe('Roles that could approve at the time: Admin. Approved as: Admin, Super Admin.')
  })
  it('is null for an older approval (both null)', () => {
    expect(approvalRolesLine(null, null)).toBeNull()
    expect(approvalRolesLine(undefined, undefined)).toBeNull()
  })
  it('shows only the approver part when nobody is recorded as able to approve (empty string)', () => {
    expect(approvalRolesLine('', 'SuperAdmin')).toBe('Approved as: Super Admin.')
  })
  it('shows only the first part when the approver role is null or empty', () => {
    expect(approvalRolesLine('Admin,Coordinator', null)).toBe('Roles that could approve at the time: Admin, Coordinator.')
    expect(approvalRolesLine('Admin,Coordinator', '')).toBe('Roles that could approve at the time: Admin, Coordinator.')
  })
  it('shows a role the helper does not know as stored', () => {
    expect(approvalRolesLine('Admin,Auditor', 'Auditor')).toBe('Roles that could approve at the time: Admin, Auditor. Approved as: Auditor.')
  })
  it('is null when both are empty strings', () => {
    expect(approvalRolesLine('', '')).toBeNull()
  })
})
