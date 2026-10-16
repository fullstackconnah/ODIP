import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PendingAgreementNotice } from './PendingAgreementNotice'
import type { PendingAgreementDto } from '@/api/types'

const person = (n: number, canReceiveServices = true): PendingAgreementDto => ({ participantId: `p-${n}`, displayName: `Person ${n}`, draftId: `d-${n}`, version: n, canReceiveServices })
const renderNotice = (waiting: PendingAgreementDto[]) => render(<MemoryRouter><PendingAgreementNotice waiting={waiting} /></MemoryRouter>)
const START = "Start a participant's services before their agreement's shifts can be rostered."

describe('PendingAgreementNotice (the brief, section 6; L10)', () => {
  it.each([
    [1, 'Person 1 v1.'],
    [2, 'Person 1 v1 and Person 2 v2.'],
    [3, 'Person 1 v1, Person 2 v2 and Person 3 v3.'],
    [5, 'Person 1 v1, Person 2 v2, Person 3 v3 and 2 more.'],
  ])('names %i waiting the house way, no serial comma, at most three', (n, names) => {
    const { container } = renderNotice(Array.from({ length: n }, (_, i) => person(i + 1)))
    expect(container).toHaveTextContent(`Shifts from a service agreement appear here once it's approved for rostering and the week is started. Waiting: ${names}`)
    expect(container).not.toHaveTextContent(START)
    expect(screen.getAllByRole('link')).toHaveLength(Math.min(n, 3))
  })

  it('says "(not active yet)" after a participant whose services have not started, and one more sentence about it', () => {
    const { container } = renderNotice([person(1), person(2, false)])
    expect(container).toHaveTextContent(`Waiting: Person 1 v1 and Person 2 v2 (not active yet). ${START}`)
    // Still a link to their agreement: that is where it is approved.
    expect(screen.getByRole('link', { name: 'Person 2 v2: open the service agreement' })).toHaveAttribute('href', '/participants/p-2/agreement-draft')
  })

  it('adds the sentence when the participant who is not active is one of the "more"', () => {
    const { container } = renderNotice([person(1), person(2), person(3), person(4, false)])
    expect(container).toHaveTextContent(`Person 3 v3 and 1 more. ${START}`)
  })

  it("links each name to that participant's agreement, its accessible name starting with the visible words", () => {
    renderNotice([person(1)])
    expect(screen.getByRole('link', { name: 'Person 1 v1: open the service agreement' })).toHaveAttribute('href', '/participants/p-1/agreement-draft')
  })

  it('is a standing explanation: no live region and nothing to dismiss', () => {
    const { container } = renderNotice([person(1)])
    expect(container.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
