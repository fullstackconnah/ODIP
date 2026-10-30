import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('keeps the reason row on a phone whether or not something is off, so the bar never changes height', () => {
    h.narrow = true
    const off = render(<AgreementsBulkBar {...base} />)
    const withReason = off.container.querySelector('[id]')
    expect(withReason).toHaveTextContent('None of the ticked rows has a draft waiting.')
    off.unmount()
    const { container } = render(<AgreementsBulkBar {...base} approvable={2} />)
    const row = container.querySelector('[id]')
    expect(row).not.toBeNull()
    expect(row).toBeEmptyDOMElement()
    expect(row!.className).toBe(withReason!.className)
  })

  it('keeps the Renew reason off the phone bar at 0 and 1 ticked, and on the Renew menu item once a row is ticked', () => {
    h.narrow = true
    const { container, rerender } = render(<AgreementsBulkBar {...base} canApprove={false} selected={0} />)
    expect(container.querySelector('[id]')).toBeNull()
    rerender(<AgreementsBulkBar {...base} canApprove={false} selected={1} />)
    expect(container.querySelector('[id]')).toBeNull()
    expect(screen.queryByText(/Your role can't renew agreements/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Actions/ }))
    expect(screen.getByRole('option', { name: /Renew 1/ })).toHaveTextContent(/Your role can't renew agreements/)
  })

  it('reserves no row on a phone for a role that cannot approve, unless there is a note', () => {
    h.narrow = true
    const { container, rerender } = render(<AgreementsBulkBar {...base} canApprove={false} selected={1} />)
    expect(container.querySelector('[id]')).toBeNull()
    rerender(<AgreementsBulkBar {...base} canApprove={false} selected={1} note="Two were left out." />)
    expect(container.querySelector('[id]')).toHaveTextContent('Two were left out.')
  })

  it('announces the phone reason politely, and only on a phone', () => {
    h.narrow = true
    const phone = render(<AgreementsBulkBar {...base} />)
    expect(phone.container.querySelector('[id]')).toHaveAttribute('aria-live', 'polite')
    phone.unmount()
    h.narrow = false
    const wide = render(<AgreementsBulkBar {...base} />)
    expect(wide.container.querySelector('[id]')).not.toHaveAttribute('aria-live')
  })

  it('adds nothing when no action is off for a reason', () => {
    h.narrow = false
    const { container } = render(<AgreementsBulkBar {...base} approvable={2} />)
    expect(container.querySelector('[id]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve 2' })).not.toHaveAttribute('aria-describedby')
  })
})
