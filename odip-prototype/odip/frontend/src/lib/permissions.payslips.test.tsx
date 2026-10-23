import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermissions } from './permissions'

afterEach(() => localStorage.clear())

describe('portal-payslips page access', () => {
  it.each(['SupportWorker', 'ReadOnly', 'Admin', 'Coordinator'])('%s can open My payslips', role => {
    localStorage.setItem('odip_token', 't')
    localStorage.setItem('odip_user', JSON.stringify({ role }))
    expect(renderHook(() => usePermissions()).result.current.canAccessPage('portal-payslips')).toBe(true)
  })
})
