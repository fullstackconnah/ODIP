import type { ReactElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { ParticipantAlertsBanner } from './ParticipantAlertsBanner'
import type { ParticipantAlertDto } from '@/api/types'

const criticalAlert: ParticipantAlertDto = {
  type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null,
}
const warningAlert: ParticipantAlertDto = {
  type: 'routine-coverage-gap', severity: 'Warning', message: 'No active routines recorded', deepLinkTab: 'routines', linkTo: null,
}

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('ParticipantAlertsBanner', () => {
  it('renders nothing when there are no alerts', () => {
    const { container } = renderWithRouter(<ParticipantAlertsBanner alerts={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders every alert message, in the order given (already ranked Critical-first by the backend)', () => {
    renderWithRouter(<ParticipantAlertsBanner alerts={[criticalAlert, warningAlert]} />)

    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('NDIS plan end date has passed')
    expect(rows[0]).toHaveTextContent('Critical')
    expect(rows[1]).toHaveTextContent('No active routines recorded')
    expect(rows[1]).toHaveTextContent('Warning')
  })

  it('gives Critical rows assertive live-region semantics and Warning/Info rows polite semantics', () => {
    const infoAlert: ParticipantAlertDto = {
      type: 'consent-review-due', severity: 'Info', message: 'Consent form review is due', deepLinkTab: 'consents', linkTo: null,
    }
    renderWithRouter(<ParticipantAlertsBanner alerts={[criticalAlert, warningAlert, infoAlert]} />)

    // Critical interrupts (assertive) — Warning/Info are announced politely so they don't talk
    // over the screen reader for non-urgent content.
    const alertRegion = screen.getByRole('alert')
    expect(alertRegion).toHaveTextContent('NDIS plan end date has passed')

    const statusRegions = screen.getAllByRole('status')
    expect(statusRegions).toHaveLength(2)
    expect(statusRegions[0]).toHaveTextContent('No active routines recorded')
    expect(statusRegions[1]).toHaveTextContent('Consent form review is due')

    // The role lives on a wrapper, not the interactive row itself — each row is still reachable
    // and announced as a button.
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('calls onSelectTab with the alert\'s deepLinkTab when clicked', async () => {
    const user = userEvent.setup()
    const onSelectTab = vi.fn()
    renderWithRouter(<ParticipantAlertsBanner alerts={[criticalAlert]} onSelectTab={onSelectTab} />)

    await user.click(screen.getByRole('button'))

    expect(onSelectTab).toHaveBeenCalledWith('details')
  })

  it('collapses a participant with many alerts behind a "+N more" toggle, so the header does not explode', async () => {
    const user = userEvent.setup()
    const manyAlerts: ParticipantAlertDto[] = Array.from({ length: 6 }, (_, i) => ({
      type: `alert-${i}`, severity: 'Warning', message: `Alert message ${i}`, deepLinkTab: 'details', linkTo: null,
    }))
    renderWithRouter(<ParticipantAlertsBanner alerts={manyAlerts} />)

    // Only the top 3 alert rows are shown up front, plus the "+3 more" toggle.
    expect(screen.getAllByText(/Alert message \d/)).toHaveLength(3)
    const moreButton = screen.getByRole('button', { name: '+3 more alerts' })
    expect(moreButton).toBeInTheDocument()

    await user.click(moreButton)

    // Expanding reveals every alert, and a "Show fewer" toggle replaces "+N more".
    expect(screen.getAllByText(/Alert message \d/)).toHaveLength(6)
    expect(screen.queryByRole('button', { name: /more alerts/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument()
  })

  it('renders a row with linkTo as a react-router Link to that path, not a tab-select button', async () => {
    const onSelectTab = vi.fn()
    const incidentAlert: ParticipantAlertDto = {
      type: 'open-serious-incident', severity: 'Warning', message: 'Open serious incident requires review', deepLinkTab: 'details', linkTo: '/incidents/inc-1',
    }
    renderWithRouter(<ParticipantAlertsBanner alerts={[incidentAlert]} onSelectTab={onSelectTab} />)

    const link = screen.getByRole('link', { name: 'Open serious incident requires review' })
    expect(link).toHaveAttribute('href', '/incidents/inc-1')
    // A linkTo row is a link, not a tab-select button — no button role for this row.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(link)
    expect(onSelectTab).not.toHaveBeenCalled()
  })

  it('mixes linkTo and tab-select rows in the same list: the linkTo row is a Link, the other still calls onSelectTab', async () => {
    const user = userEvent.setup()
    const onSelectTab = vi.fn()
    const incidentAlert: ParticipantAlertDto = {
      type: 'open-serious-incident', severity: 'Warning', message: 'Open serious incident requires review', deepLinkTab: 'details', linkTo: '/incidents/inc-1',
    }
    renderWithRouter(<ParticipantAlertsBanner alerts={[incidentAlert, criticalAlert]} onSelectTab={onSelectTab} />)

    expect(screen.getByRole('link', { name: 'Open serious incident requires review' })).toHaveAttribute('href', '/incidents/inc-1')

    await user.click(screen.getByRole('button'))
    expect(onSelectTab).toHaveBeenCalledWith('details')
  })
})

// R2-09: the message was `truncate` (one line, ellipsis), so on a 390px phone three realistic alerts got 192-194px of the 324-474px
// they need and a safety alert read as a fragment ("NDIS plan expired on 12/08/2026 - claims cannot be su..."); a 95-character message
// was cut even at 768px. There is no hover on touch, so the `title` tooltip that "revealed" the rest never showed. jsdom does no
// layout, so this pins the mechanism: the message wraps (no nowrap / ellipsis / clip) and is always fully in the DOM.
describe('ParticipantAlertsBanner — alert text is never cut', () => {
  const longMessage = 'Medication review overdue by 21 days (Risperidone 2mg) - schedule a review with the prescriber before the next trip departs on 14/10/2026 so the plan of care stays current'
  const longButtonAlert: ParticipantAlertDto = { type: 'med-review', severity: 'Critical', message: longMessage, deepLinkTab: 'medications', linkTo: null }
  const longLinkAlert: ParticipantAlertDto = { type: 'open-incident', severity: 'Warning', message: longMessage + ' (incident follow-up)', deepLinkTab: 'details', linkTo: '/incidents/inc-9' }

  const CUTTING = ['truncate', 'whitespace-nowrap', 'text-ellipsis', 'overflow-hidden', 'line-clamp-1', 'line-clamp-2']

  it('lets a tab-select row\'s message wrap: min-w-0 in the flex row, break-words, none of the classes that clip it', () => {
    renderWithRouter(<ParticipantAlertsBanner alerts={[longButtonAlert]} />)
    const message = screen.getByText(longMessage)
    expect(message).toHaveClass('flex-1', 'min-w-0', 'break-words')
    for (const c of CUTTING) expect(message, c).not.toHaveClass(c)
  })

  it('does the same for a linkTo row', () => {
    renderWithRouter(<ParticipantAlertsBanner alerts={[longLinkAlert]} />)
    const message = screen.getByText(longMessage + ' (incident follow-up)')
    expect(message).toHaveClass('flex-1', 'min-w-0', 'break-words')
    for (const c of CUTTING) expect(message, c).not.toHaveClass(c)
  })

  it('keeps the full text in the row\'s accessible name and content, with the icon and severity label pinned beside it', () => {
    renderWithRouter(<ParticipantAlertsBanner alerts={[longButtonAlert]} />)
    const row = screen.getByRole('button')
    expect(row).toHaveTextContent(longMessage)
    expect(row).toHaveTextContent('Critical')
    // The row is a flex row that starts at the top edge so a wrapped message reads from the first line, not the middle.
    expect(row).toHaveClass('flex', 'items-start')
    expect(screen.getByText('Critical')).toHaveClass('shrink-0')
  })
})
