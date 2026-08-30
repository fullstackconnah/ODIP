import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantAlertsBanner } from './ParticipantAlertsBanner'
import type { ParticipantAlertDto } from '@/api/types'

const criticalAlert: ParticipantAlertDto = {
  type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details',
}
const warningAlert: ParticipantAlertDto = {
  type: 'routine-coverage-gap', severity: 'Warning', message: 'No active routines recorded', deepLinkTab: 'routines',
}

describe('ParticipantAlertsBanner', () => {
  it('renders nothing when there are no alerts', () => {
    const { container } = render(<ParticipantAlertsBanner alerts={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders every alert message, in the order given (already ranked Critical-first by the backend)', () => {
    render(<ParticipantAlertsBanner alerts={[criticalAlert, warningAlert]} />)

    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('NDIS plan end date has passed')
    expect(rows[0]).toHaveTextContent('Critical')
    expect(rows[1]).toHaveTextContent('No active routines recorded')
    expect(rows[1]).toHaveTextContent('Warning')
  })

  it('calls onSelectTab with the alert\'s deepLinkTab when clicked', async () => {
    const user = userEvent.setup()
    const onSelectTab = vi.fn()
    render(<ParticipantAlertsBanner alerts={[criticalAlert]} onSelectTab={onSelectTab} />)

    await user.click(screen.getByRole('button'))

    expect(onSelectTab).toHaveBeenCalledWith('details')
  })

  it('collapses a participant with many alerts behind a "+N more" toggle, so the header does not explode', async () => {
    const user = userEvent.setup()
    const manyAlerts: ParticipantAlertDto[] = Array.from({ length: 6 }, (_, i) => ({
      type: `alert-${i}`, severity: 'Warning', message: `Alert message ${i}`, deepLinkTab: 'details',
    }))
    render(<ParticipantAlertsBanner alerts={manyAlerts} />)

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
})
