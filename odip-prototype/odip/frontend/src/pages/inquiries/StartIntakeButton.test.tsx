import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { IntakeVisitDto } from '@/api/types/inquiries'
import { StartIntakeButton } from './StartIntakeButton'

const mocks = vi.hoisted(() => ({ convert: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useConvertParticipantInquiry: () => ({ mutate: mocks.convert, isPending: false }) }))

const visit = (overrides: Partial<IntakeVisitDto> = {}): IntakeVisitDto => ({
  inquiryId: 'inq-1', firstName: 'Ari', lastName: 'Walsh', participantId: null, participantIsDraft: null, participantIntakeCompletedAt: null,
  startsAt: '2030-10-15T23:00:00Z', durationMinutes: 90, location: 'Home', staffUserId: 'dana', staffName: 'Dana Smith', confirmedAt: null,
  timeZoneId: 'Australia/Sydney', hasAddress: true, contactNeedsName: false, ...overrides,
})
const show = (v: IntakeVisitDto) => render(<MemoryRouter><StartIntakeButton visit={v} /></MemoryRouter>)

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mocks.convert.mockReset()
})

describe('StartIntakeButton: the intake gates (L5, D1, G2)', () => {
  it("without the address: aria-disabled, says it needs Ari's full address, links there, and does nothing", async () => {
    const user = userEvent.setup()
    show(visit({ hasAddress: false }))
    const button = screen.getByRole('button', { name: /^Start intake/ })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    const line = screen.getByText(/Start intake needs Ari's full address\./)
    expect(button).toHaveAttribute('aria-describedby', line.id)
    expect(screen.getByRole('link', { name: 'Add an address to start intake' })).toHaveAttribute('href', '/participants/new-inquiry?id=inq-1&focus=address')
    await user.click(button)
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it("without the main contact's name: says so, and links to the contact", () => {
    show(visit({ contactNeedsName: true }))
    expect(screen.getByText(/Start intake needs the main contact's name\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Add the main contact's name to start intake" })).toHaveAttribute('href', '/participants/new-inquiry?id=inq-1&focus=contact')
  })

  it('enabled when both are clear: it converts', async () => {
    const user = userEvent.setup()
    show(visit())
    const button = screen.getByRole('button', { name: /^Start intake/ })
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await user.click(button)
    expect(mocks.convert).toHaveBeenCalledWith({ id: 'inq-1' }, expect.any(Object))
  })
})
