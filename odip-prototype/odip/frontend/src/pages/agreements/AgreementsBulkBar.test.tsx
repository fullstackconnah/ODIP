import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgreementsBulkBar } from './AgreementsBulkBar'

const h = vi.hoisted(() => ({ narrow: false }))
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => h.narrow }))

const noop = () => {}
const base = { selected: 2, approvable: 0, canApprove: true, shown: 5, allShownSelected: false, onToggleShown: noop, onClear: noop, onApprove: noop, onAction: noop }

describe('AgreementsBulkBar disabled reasons', () => {
  it('shows why Approve is off as text and ties the button to it', () => {
    h.narrow = false
    render(<AgreementsBulkBar {...base} />)
    const reason = screen.getByText('None of the ticked rows has a draft waiting.')
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription('None of the ticked rows has a draft waiting.')
    expect(approve.getAttribute('aria-describedby')).toBe(reason.id)
  })

  it('shows why Renew is off for a role that cannot approve, and ties the button to it', () => {
    h.narrow = false
    render(<AgreementsBulkBar {...base} canApprove={false} />)
    expect(screen.getByRole('button', { name: /Renew/ })).toHaveAccessibleDescription(/Your role can't renew agreements/)
  })

  it('shows the same reason on a phone, where the Actions menu is closed', () => {
    h.narrow = true
    render(<AgreementsBulkBar {...base} />)
    expect(screen.getByText('None of the ticked rows has a draft waiting.')).toBeVisible()
  })

  it('adds nothing when no action is off for a reason', () => {
    h.narrow = false
    const { container } = render(<AgreementsBulkBar {...base} approvable={2} />)
    expect(container.querySelector('[id]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve 2' })).not.toHaveAttribute('aria-describedby')
  })
})
