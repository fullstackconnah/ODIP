import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RosterGateFields } from './RosterGateFields'
import { makeFinding } from '../test-fixtures'

// The shared findings block, as the budget phase 3 design review changed it (H3, M1, M5, M7): the reason box only when a finding asks for a reason (a note nobody keeps is not offered), the box's own words
// and the refusal sentence supplied by a caller that knows what is being asked, and one polite live summary that can carry a caller's note.

afterEach(() => cleanup())

const noop = () => {}

function Gate(p: Partial<React.ComponentProps<typeof RosterGateFields>>) {
  return <RosterGateFields findings={[]} overrideReason="" onOverrideReasonChange={noop} reasonRequired={false} {...p} />
}

const reasonRequired = makeFinding({ code: 'STAFF_ON_LEAVE', message: 'Staff is on approved leave.', requiresReason: true })
const softWarning = makeFinding({ code: 'STAFF_LEAVE_PENDING', message: 'Pending leave overlaps this window.', requiresReason: false })
const blocking = makeFinding({ code: 'WSC_EXPIRED', severity: 'Blocking', message: 'Screening has expired.' })

describe('the reason box (M1: a note nobody keeps is not offered)', () => {
  it('shows no reason box for a warning that asks for nothing: the server discards a reason no finding requires', () => {
    render(<Gate findings={[softWarning]} />)

    expect(screen.queryByLabelText(/reason for override/i)).not.toBeInTheDocument()
  })

  it('shows the required box when a finding asks for a reason', () => {
    render(<Gate findings={[reasonRequired]} />)

    expect(screen.getByLabelText(/reason for override/i)).toBeRequired()
  })

  it('keeps a stored reason readable when the caller forces the box', () => {
    render(<Gate findings={[]} forceVisible overrideReason="Approved by team lead" />)

    expect(screen.getByLabelText(/reason for override/i)).toHaveValue('Approved by team lead')
  })

  it('keeps the generic words by default', () => {
    render(<Gate findings={[reasonRequired]} reasonRequired />)

    expect(screen.getByPlaceholderText('Why this assignment should proceed despite the warnings above')).toBeInTheDocument()
    expect(screen.getByText('A reason is required to save over the warnings marked “Reason required”.')).toBeInTheDocument()
  })

  it('takes the caller’s hint, placeholder and error when it knows what the reason is for (M5)', () => {
    render(
      <Gate
        findings={[reasonRequired]}
        reasonRequired
        reasonCopy={{ hint: 'The hard limit is on. This reason is recorded in the audit log.', placeholder: 'Why this shift should go ahead past the budget', error: 'Add a reason to save this shift past the budget.' }}
      />,
    )

    expect(screen.getByPlaceholderText('Why this shift should go ahead past the budget')).toBeInTheDocument()
    expect(screen.getByText('Add a reason to save this shift past the budget.')).toBeInTheDocument()
    expect(screen.queryByText(/A reason is required to save over the warnings/)).not.toBeInTheDocument()
  })

  it('shows the hint under the box while there is no error', () => {
    render(<Gate findings={[reasonRequired]} reasonCopy={{ hint: 'The hard limit is on. This reason is recorded in the audit log.' }} />)

    expect(screen.getByLabelText(/reason for override/i)).toHaveAccessibleDescription('The hard limit is on. This reason is recorded in the audit log.')
  })
})

describe('the sentence under an open Blocking finding (H3)', () => {
  it('is the generic sentence by default', () => {
    render(<Gate findings={[blocking]} />)

    expect(screen.getByRole('alert')).toHaveTextContent("This assignment can't be saved while a blocking finding is open.")
  })

  it('is the caller’s own sentence when one is given, with the id the caller points a control at', () => {
    render(<Gate findings={[blocking]} blockingMessage="The hard limit is on, so this shift can't be saved as it is." blockingMessageId="refusal-1" />)

    const sentence = screen.getByText("The hard limit is on, so this shift can't be saved as it is.")
    expect(sentence).toHaveAttribute('id', 'refusal-1')
    expect(screen.queryByText(/blocking finding is open/)).not.toBeInTheDocument()
  })

  it('is not said at all once the caller says every Blocking finding has been answered', () => {
    render(<Gate findings={[blocking]} blockingAnswered blockingMessage="Not shown" />)

    expect(screen.queryByText('Not shown')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the live summary (M7)', () => {
  it('counts the findings, as it always did', () => {
    render(<Gate findings={[blocking, softWarning]} />)

    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Roster check complete: 2 findings, 1 blocking.')
  })

  it('carries a caller’s note in the same region, so the panel keeps one live region and not two', () => {
    render(<Gate findings={[blocking]} liveNote="Over budget. Save is off. Emergency or safety is available below." />)

    const regions = document.querySelectorAll('[aria-live]')
    expect(regions).toHaveLength(1)
    expect(regions[0]).toHaveTextContent('Roster check complete: 1 finding, 1 blocking. Over budget. Save is off. Emergency or safety is available below.')
  })

  it('says the note even when the check found nothing', () => {
    render(<Gate findings={[]} liveNote="Budget not checked: sleepover shifts are not priced yet." />)

    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Roster check complete: no conflicts found. Budget not checked: sleepover shifts are not priced yet.')
  })
})

describe('nothing else about the block changed', () => {
  it('lists the findings under a "Findings" heading and says nothing for an empty list', () => {
    const { rerender } = render(<Gate findings={[softWarning]} />)
    expect(screen.getByText('Findings')).toBeInTheDocument()

    rerender(<Gate findings={[]} />)
    expect(screen.queryByText('Findings')).not.toBeInTheDocument()
  })

  it('hands the typed reason to its caller', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Gate findings={[reasonRequired]} onOverrideReasonChange={onChange} />)

    await user.type(screen.getByLabelText(/reason for override/i), 'a')

    expect(onChange).toHaveBeenCalledWith('a')
  })
})
