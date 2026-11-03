import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PendingAgreementsPanel } from './PendingAgreementNotice'
import type { PendingAgreementDto } from '@/api/types'

const person = (n: number, canReceiveServices = true): PendingAgreementDto => ({ participantId: `p-${n}`, displayName: `Person ${n}`, draftId: `d-${n}`, version: n, canReceiveServices })
const renderPanel = (waiting: PendingAgreementDto[]) => render(<MemoryRouter><PendingAgreementsPanel waiting={waiting} onClose={vi.fn()} /></MemoryRouter>)
const START = "Start a participant's services before their agreement's shifts can be rostered."

describe('PendingAgreementsPanel (roster declutter: the status line disclosure; L10)', () => {
  it('is a slide-over named for what it lists, with the explanation sentence', () => {
    renderPanel([person(1)])
    const dialog = screen.getByRole('dialog', { name: 'Agreements waiting for approval' })
    expect(dialog).toHaveTextContent("Shifts from a service agreement appear on the board once it's approved for rostering.")
    expect(dialog).not.toHaveTextContent(START)
  })

  it('lists every name, one per line, with no "and N more"', () => {
    renderPanel(Array.from({ length: 5 }, (_, i) => person(i + 1)))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getAllByRole('link')).toHaveLength(5)
    expect(screen.getByRole('dialog')).not.toHaveTextContent('more')
  })

  it('says "(not active yet)" after a participant whose services have not started, and one more sentence about it', () => {
    renderPanel([person(1), person(2, false)])
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Person 2 v2 (not active yet)')
    expect(screen.getByRole('dialog')).toHaveTextContent(START)
    // Still a link to their agreement: that is where it is approved.
    expect(screen.getByRole('link', { name: 'Person 2 v2: open the service agreement' })).toHaveAttribute('href', '/participants/p-2/agreement-draft')
  })

  it("links each name to that participant's agreement, its accessible name starting with the visible words", () => {
    renderPanel([person(1)])
    expect(screen.getByRole('link', { name: 'Person 1 v1: open the service agreement' })).toHaveAttribute('href', '/participants/p-1/agreement-draft')
  })
})
