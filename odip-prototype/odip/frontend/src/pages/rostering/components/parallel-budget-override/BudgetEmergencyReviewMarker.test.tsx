// BudgetEmergencyReviewMarker: a shift that went over budget on purpose, and the audit facts that
// exist. This suite exists to protect one thing above all — the absence of an invented approval.

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { BudgetEmergencyReviewMarker } from './BudgetEmergencyReviewMarker'
import { OVER_BUDGET_MARKER, markerForAcknowledgedCodes } from './budgetOverrideTypes'
import type { EmergencyReviewDetails } from './budgetOverrideTypes'
import {
  adminOverrideShift,
  pendingEmergency,
  restrictedPendingEmergency,
  reviewedEmergency,
} from './fixtures'

afterEach(() => cleanup())

const valueOf = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!.textContent!.trim()

/** The marker/review pill, which is the only place the review state is spelled as a word. */
const reviewBadge = () => screen.getByText(/Admin review pending|^Reviewed$/)

/**
 * The detail rows' values, and nothing else. The component's own sentences contain an ordinary
 * em dash ("… review it — this has not been approved"), so a whole-text scan for a dash proves
 * nothing about whether a FIELD was left blank.
 */
const detailValues = () => [...document.querySelectorAll('dd')].map(dd => dd.textContent!.trim())

describe('a shift saved as an emergency, not yet reviewed', () => {
  it('carries the emergency marker word, not the Admin one', () => {
    render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(screen.getByText(OVER_BUDGET_MARKER.emergency)).toBeInTheDocument()
    expect(screen.queryByText(OVER_BUDGET_MARKER.adminOverride)).not.toBeInTheDocument()
  })

  it('says the Admin review is pending, in the awaiting-somebody tone', () => {
    render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(reviewBadge()).toHaveTextContent('Admin review pending')
  })

  it('says in words that it has not been approved', () => {
    render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(screen.getByText(/has not been approved/)).toBeInTheDocument()
  })

  it('never claims an approval, in any state', () => {
    // The one legitimate use of the word is the refusal itself ("this has NOT been approved").
    // Strip that sentence, then nothing may say approved.
    for (const details of [pendingEmergency, reviewedEmergency, adminOverrideShift, restrictedPendingEmergency]) {
      const { unmount } = render(<BudgetEmergencyReviewMarker details={details} />)
      const withoutTheRefusal = (document.body.textContent ?? '').replace(/this has not been approved/gi, '')
      expect(withoutTheRefusal).not.toMatch(/approved/i)
      unmount()
    }
  })

  it('claims no approval in the reviewed state either: a review is not an approval to claim', () => {
    const { unmount } = render(<BudgetEmergencyReviewMarker details={reviewedEmergency} />)
    expect(document.body.textContent).not.toMatch(/approved/i)
    unmount()
  })

  it('shows the reason that was recorded, including the server’s emergency prefix', () => {
    render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(valueOf('Reason given')).toBe(pendingEmergency.reason)
    expect(valueOf('Reason given')).toMatch(/^Emergency or safety: /)
  })

  it('shows the review task the server raised, so the review is traceable to its obligation', () => {
    render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(valueOf('Review task')).toBe(pendingEmergency.reviewTaskTitle)
  })

  it('shows when the shift was recorded, in the app’s en-AU format', () => {
    render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(valueOf('Recorded')).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('shows no review timestamp while the review has not happened', () => {
    render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(screen.queryByText('Review completed')).not.toBeInTheDocument()
  })

  it('shows no reviewer name while the review has not happened, and says so in words instead', () => {
    render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(detailValues()).not.toContain('Priya Raman')
    // "Reviewed by: Not reviewed yet" is deliberate. An absent row reads as "nobody needs to
    // review this", which is the one reading a pending safety shift must never give.
    expect(valueOf('Reviewed by')).toBe('Not reviewed yet')
  })

  it('leaves no field blank, so nothing reads as an unfilled value', () => {
    render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    for (const value of detailValues()) {
      expect(value).not.toBe('')
      expect(value).not.toBe('—')
      expect(value).not.toBe('–')
    }
  })
})

describe('a shift whose review has happened', () => {
  it('says Reviewed, not pending', () => {
    render(<BudgetEmergencyReviewMarker details={reviewedEmergency} />)
    expect(reviewBadge()).toHaveTextContent('Reviewed')
    expect(screen.queryByText('Admin review pending')).not.toBeInTheDocument()
  })

  it('spells "Reviewed" exactly once, on the badge, so the row beneath it is never ambiguous', () => {
    render(<BudgetEmergencyReviewMarker details={reviewedEmergency} />)
    expect(screen.getAllByText(/^Reviewed$/)).toHaveLength(1)
  })

  it('shows the reviewer and when, from what the server sent', () => {
    render(<BudgetEmergencyReviewMarker details={reviewedEmergency} />)
    expect(valueOf('Reviewed by')).toBe('Priya Raman')
    expect(valueOf('Review completed')).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('drops the not-approved sentence and the not-reviewed row, because neither is true any more', () => {
    render(<BudgetEmergencyReviewMarker details={reviewedEmergency} />)
    expect(screen.queryByText(/has not been approved/)).not.toBeInTheDocument()
    expect(screen.queryByText('Not reviewed yet')).not.toBeInTheDocument()
  })
})

describe('a shift saved through an Admin override', () => {
  it('carries the Admin marker, not the emergency one', () => {
    render(<BudgetEmergencyReviewMarker details={adminOverrideShift} />)
    expect(screen.getByText(OVER_BUDGET_MARKER.adminOverride)).toBeInTheDocument()
    expect(screen.queryByText(OVER_BUDGET_MARKER.emergency)).not.toBeInTheDocument()
  })

  it('shows the override reason with no emergency prefix on it', () => {
    render(<BudgetEmergencyReviewMarker details={adminOverrideShift} />)
    expect(valueOf('Reason given')).not.toMatch(/^Emergency or safety: /)
  })

  it('has no review to wait for: an Admin override is an Admin’s own act, so there is no badge, no not-approved sentence and no reviewer row', () => {
    render(<BudgetEmergencyReviewMarker details={adminOverrideShift} />)

    expect(screen.queryByText(/Admin review pending|^Reviewed$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/has not been approved/)).not.toBeInTheDocument()
    expect(screen.queryByText('Reviewed by', { selector: 'dt' })).not.toBeInTheDocument()
  })
})

describe('an emergency whose review task could not be found', () => {
  it('reads as pending: a review nobody can show has not happened', () => {
    render(<BudgetEmergencyReviewMarker details={{ kind: 'emergency', reason: 'Emergency or safety: Unsafe tonight' }} />)

    expect(reviewBadge()).toHaveTextContent('Admin review pending')
    expect(screen.getByText(/has not been approved/)).toBeInTheDocument()
  })
})

describe('a review day the server sends as a date', () => {
  it('shows the day in the app’s en-AU format, without shifting it across a time zone', () => {
    render(<BudgetEmergencyReviewMarker details={{ ...reviewedEmergency, reviewedAt: null, reviewedOn: '2026-10-05' }} />)

    expect(valueOf('Review completed')).toBe('05/10/2026')
  })
})

describe('a privacy-restricted view', () => {
  it('shows the marker and the review state, and nothing else', () => {
    render(<BudgetEmergencyReviewMarker details={restrictedPendingEmergency} />)
    expect(screen.getByText(OVER_BUDGET_MARKER.emergency)).toBeInTheDocument()
    expect(reviewBadge()).toHaveTextContent('Admin review pending')
  })

  it('does not render the reason, the reviewer or the task title', () => {
    render(<BudgetEmergencyReviewMarker details={restrictedPendingEmergency} />)
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Participant was unsafe')
    expect(text).not.toContain('Review emergency shift past budget')
  })

  it('renders no detail rows at all, rather than rows of dashes', () => {
    const { container } = render(<BudgetEmergencyReviewMarker details={restrictedPendingEmergency} />)
    expect(container.querySelector('dl')).toBeNull()
  })

  it('keeps the not-approved sentence, so the state is still legible', () => {
    render(<BudgetEmergencyReviewMarker details={restrictedPendingEmergency} />)
    expect(screen.getByText(/has not been approved/)).toBeInTheDocument()
  })
})

describe('the marker kind comes from a code, never from the stored text', () => {
  // F-16 (design preflight t_1fbc9426, mandatory): the marker must be derived from
  // AcknowledgedFindingCodes. Free text can contain "Emergency or safety: " — a coordinator can
  // type it into an ordinary override reason — and a false emergency marker is a false audit
  // record. The `kind` prop is what a caller sets from the code; this suite pins that the words
  // in the stored reason never decide it.
  it('reads BUDGET_EMERGENCY as an emergency marker', () => {
    expect(markerForAcknowledgedCodes(['BUDGET_EMERGENCY'])).toBe('emergency')
  })

  it('reads a plain budget acknowledgement as an Admin override marker', () => {
    expect(markerForAcknowledgedCodes(['BUDGET_FORECAST_OVER'])).toBe('adminOverride')
  })

  it('says no marker at all when the server acknowledged nothing budget-related', () => {
    expect(markerForAcknowledgedCodes(['STAFF_LEAVE_PENDING'])).toBeNull()
    expect(markerForAcknowledgedCodes([])).toBeNull()
  })

  it('prefers the emergency marker when both codes are present, because that is the stronger fact', () => {
    expect(markerForAcknowledgedCodes(['BUDGET_FORECAST_OVER', 'BUDGET_EMERGENCY'])).toBe('emergency')
  })

  it('ignores the stored reason text entirely, so a typed prefix cannot forge a marker', () => {
    const forged: EmergencyReviewDetails = {
      ...pendingEmergency,
      kind: 'adminOverride',
      // A coordinator wrote the emergency prefix into an ORDINARY override reason. The kind prop
      // says adminOverride, so the marker must follow the prop and not the words.
      reason: 'Emergency or safety: typed into the wrong box by a coordinator',
    }
    render(<BudgetEmergencyReviewMarker details={forged} />)
    expect(screen.getByText(OVER_BUDGET_MARKER.adminOverride)).toBeInTheDocument()
    expect(screen.queryByText(OVER_BUDGET_MARKER.emergency)).not.toBeInTheDocument()
  })
})

describe('a long reason at a phone width', () => {
  it('wraps a long reason rather than clipping it', () => {
    const long: EmergencyReviewDetails = {
      ...pendingEmergency,
      reason:
        'Emergency or safety: Participant was unsafe at the time of the shift and the support ' +
        'worker on the previous shift had already escalated to the on-call coordinator by radio, ' +
        'so cover had to be arranged immediately.',
    }
    render(<BudgetEmergencyReviewMarker details={long} />)
    const dd = screen.getByText('Reason given', { selector: 'dt' }).parentElement!.querySelector('dd')!
    expect(dd.className).toMatch(/whitespace-pre-wrap/)
    expect(dd.className).toMatch(/break-words/)
    expect(valueOf('Reason given')).toContain('by radio')
  })

  it('a long review task title is readable, not cut to one line', () => {
    const long: EmergencyReviewDetails = {
      ...pendingEmergency,
      reviewTaskTitle:
        'Review emergency shift past budget: a participant with a deliberately long display name on a day',
    }
    render(<BudgetEmergencyReviewMarker details={long} />)
    expect(valueOf('Review task')).toContain('deliberately long display name')
  })
})

describe('the marker is a marker, not a link', () => {
  it('renders no anchor and no button: the chip around it is the only target', () => {
    const { container } = render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })

  it('carries a stable hook for the board chip and the slide-over to find it by', () => {
    const { container } = render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(container.firstElementChild).toHaveAttribute('data-budget-marker', 'emergency')
  })
})

describe('absent server fields', () => {
  it('omits a row entirely when the field was never sent', () => {
    render(<BudgetEmergencyReviewMarker details={{ ...pendingEmergency, reviewTaskTitle: null }} />)
    expect(screen.queryByText('Review task')).not.toBeInTheDocument()
  })

  it('omits the recorded-time row when the server never sent one, rather than blanking it', () => {
    render(<BudgetEmergencyReviewMarker details={{ ...pendingEmergency, recordedAt: null }} />)
    expect(screen.queryByText('Recorded', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('survives a details object with nothing optional on it at all', () => {
    const bare: EmergencyReviewDetails = { kind: 'emergency', state: 'pending', reason: 'Unsafe today' }
    expect(() => render(<BudgetEmergencyReviewMarker details={bare} />)).not.toThrow()
    expect(reviewBadge()).toHaveTextContent('Admin review pending')
  })

  it('a reviewed shift with no review timestamp does not claim one', () => {
    render(<BudgetEmergencyReviewMarker details={{ ...reviewedEmergency, reviewedAt: null }} />)
    expect(screen.queryByText('Review completed')).not.toBeInTheDocument()
    expect(reviewBadge()).toHaveTextContent('Reviewed')
  })
})

describe('status is colour plus text, never colour alone', () => {
  it('prints the review state as a word in every state', () => {
    const { unmount } = render(<BudgetEmergencyReviewMarker details={pendingEmergency} />)
    expect(screen.getByText('Admin review pending')).toBeInTheDocument()
    unmount()
    render(<BudgetEmergencyReviewMarker details={reviewedEmergency} />)
    expect(screen.getByText('Reviewed')).toBeInTheDocument()
  })
})
