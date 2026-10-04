// The pure rules, pinned without a DOM: which paths a caller authorises, what counts as a reason,
// and the two sentences that must never imply the server is on this side of the fence.

import { describe, it, expect } from 'vitest'
import {
  EMERGENCY_REASON_PREFIX,
  MIN_REASON_LENGTH,
  OVER_BUDGET_MARKER,
  availableChoices,
  canSubmit,
  emergencyReviewBadge,
  isMeaningfulReason,
  meetsEmergencyMinimum,
  normalisedReason,
  reasonError,
  storedReason,
  markerForAcknowledgedCodes,
} from './budgetOverrideTypes'
import { RESTRICTED_FIGURE, figureIsKnown, figureText, overrunSentence } from './budgetFigures'
import {
  GOOD_EMERGENCY_REASON,
  SHORT_REASON,
  adminCapabilities,
  amount,
  coordinatorCapabilities,
  emptyFigures,
  fullFigures,
  noPathCapabilities,
  notRecorded,
  restrictedFigures,
  unknown,
  zeroFigures,
} from './fixtures'

describe('availableChoices', () => {
  it('offers the emergency path to a Coordinator and not an ordinary override', () => {
    expect(availableChoices(coordinatorCapabilities)).toEqual(['emergency'])
  })

  it('offers both paths to an Admin', () => {
    expect(availableChoices(adminCapabilities)).toEqual(['adminOverride', 'emergency'])
  })

  it('offers nothing when the caller authorises nothing — an unauthorised path is absent, not disabled', () => {
    expect(availableChoices(noPathCapabilities)).toEqual([])
  })
})

describe('isMeaningfulReason', () => {
  it('accepts a reason with real words', () => {
    expect(isMeaningfulReason('Plan manager confirmed the increase')).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['one space', ' '],
    ['many spaces', '        '],
    ['a tab run', '\t\t\t'],
    ['newlines only', '\n\n\n'],
    ['a mix of every whitespace class', ' \t\r\n  '],
  ])('rejects %s', (_label, value) => {
    expect(isMeaningfulReason(value)).toBe(false)
  })

  it('trims before deciding, so padding around a real reason does not matter', () => {
    expect(isMeaningfulReason('  Unsafe today  ')).toBe(true)
  })
})

describe('meetsEmergencyMinimum', () => {
  it(`rejects a reason under ${MIN_REASON_LENGTH} trimmed characters`, () => {
    expect(meetsEmergencyMinimum(SHORT_REASON)).toBe(false)
  })

  it('accepts a reason at exactly the minimum', () => {
    expect(meetsEmergencyMinimum('x'.repeat(MIN_REASON_LENGTH))).toBe(true)
  })

  it('does not count padding toward the minimum: ten spaces is not ten characters of explanation', () => {
    expect(meetsEmergencyMinimum(' '.repeat(MIN_REASON_LENGTH))).toBe(false)
  })
})

describe('normalisedReason', () => {
  it('sends the trimmed text', () => {
    expect(normalisedReason('  Unsafe today  ')).toBe('Unsafe today')
  })

  it('sends null rather than an empty string, so the API omits the field', () => {
    expect(normalisedReason('   ')).toBeNull()
  })
})

describe('reasonError', () => {
  it('says nothing before the user has tried to go ahead', () => {
    expect(reasonError('emergency', '', false)).toBeNull()
  })

  it('says nothing when no path is chosen, whatever the text says', () => {
    expect(reasonError('none', 'anything at all', true)).toBeNull()
  })

  it('rejects a whitespace-only reason after an attempt', () => {
    expect(reasonError('adminOverride', '   ', true)).toMatch(/Write why this shift should go ahead/)
  })

  it('asks for the emergency minimum only on the emergency path', () => {
    expect(reasonError('emergency', SHORT_REASON, true)).toMatch(/at least 10 characters/)
    expect(reasonError('adminOverride', SHORT_REASON, true)).toBeNull()
  })

  it('accepts a good reason on both paths', () => {
    expect(reasonError('emergency', GOOD_EMERGENCY_REASON, true)).toBeNull()
    expect(reasonError('adminOverride', 'Confirmed by the plan manager', true)).toBeNull()
  })
})

describe('canSubmit', () => {
  it('refuses with no path chosen', () => {
    expect(canSubmit('none', GOOD_EMERGENCY_REASON)).toBe(false)
  })

  it('refuses a whitespace-only reason on either path', () => {
    expect(canSubmit('adminOverride', '  \n ')).toBe(false)
    expect(canSubmit('emergency', '\t\t')).toBe(false)
  })

  it('refuses a short emergency reason but allows a short Admin reason', () => {
    expect(canSubmit('emergency', SHORT_REASON)).toBe(false)
    expect(canSubmit('adminOverride', SHORT_REASON)).toBe(true)
  })

  it('allows an Admin reason of any real length', () => {
    expect(canSubmit('adminOverride', 'Confirmed by the plan manager')).toBe(true)
  })
})

describe('storedReason', () => {
  it('prefixes the emergency reason exactly as the server stores it', () => {
    expect(storedReason('emergency', '  Unsafe today  ')).toBe(`${EMERGENCY_REASON_PREFIX}Unsafe today`)
  })

  it('stores an ordinary override verbatim, with no prefix', () => {
    expect(storedReason('adminOverride', '  Confirmed  ')).toBe('Confirmed')
  })

  it('stores null when there is nothing to store', () => {
    expect(storedReason('adminOverride', '   ')).toBeNull()
  })
})

describe('the over-budget markers', () => {
  it('reads as the shift going over, on both paths', () => {
    expect(OVER_BUDGET_MARKER.emergency).toBe('Over budget: emergency')
    expect(OVER_BUDGET_MARKER.adminOverride).toBe('Over budget: Admin override')
  })
})

describe('markerForAcknowledgedCodes', () => {
  // F-16 (design preflight): the marker comes from the acknowledged CODE. The stored reason is
  // free text, and a coordinator can type "Emergency or safety: " into an ordinary override —
  // a marker read off the string would put a false emergency into the audit record.
  it('maps BUDGET_EMERGENCY to the emergency marker', () => {
    expect(markerForAcknowledgedCodes(['BUDGET_EMERGENCY'])).toBe('emergency')
  })

  it('maps a budget acknowledgement without the emergency code to the Admin override marker', () => {
    expect(markerForAcknowledgedCodes(['BUDGET_FORECAST_OVER'])).toBe('adminOverride')
  })

  it('returns null for no codes, and for codes with nothing budget about them', () => {
    expect(markerForAcknowledgedCodes([])).toBeNull()
    expect(markerForAcknowledgedCodes(null)).toBeNull()
    expect(markerForAcknowledgedCodes(undefined)).toBeNull()
    expect(markerForAcknowledgedCodes(['STAFF_LEAVE_PENDING', 'COMPATIBILITY_EXCLUDED'])).toBeNull()
  })

  it('prefers the emergency marker when both codes are on the same save', () => {
    expect(markerForAcknowledgedCodes(['BUDGET_FORECAST_OVER', 'BUDGET_EMERGENCY'])).toBe('emergency')
  })

  it('never reads the reason text: only the codes it is given', () => {
    // There is no reason parameter at all, which is the point: a caller cannot pass free text
    // in by accident, and cannot bypass the code by parsing one out of a string.
    expect(markerForAcknowledgedCodes.length).toBe(1)
  })
})

describe('emergencyReviewBadge', () => {
  it('says a review is pending, in the awaiting-somebody tone', () => {
    expect(emergencyReviewBadge('pending')).toEqual({ label: 'Admin review pending', tone: 'warning' })
  })

  it('only claims a review once there has been one', () => {
    expect(emergencyReviewBadge('reviewed')).toEqual({ label: 'Reviewed', tone: 'success' })
  })

  it('never offers an "approved" state to mistake a save for a sign-off', () => {
    const labels = [emergencyReviewBadge('pending').label, emergencyReviewBadge('reviewed').label]
    expect(labels.join(' ')).not.toMatch(/approved/i)
  })
})

describe('figureText', () => {
  it('prints a recorded amount as AUD', () => {
    expect(figureText(amount(8640))).toBe('$8,640.00')
  })

  it('prints a recorded zero as $0.00 — zero is an answer, not an absence', () => {
    expect(figureText(amount(0))).toBe('$0.00')
  })

  it.each([
    ['not recorded', notRecorded],
    ['not yet known', unknown],
  ])('prints an en dash, never a 0, when the figure is %s', (_label, figure) => {
    expect(figureText(figure)).toBe('–')
    expect(figureText(figure)).not.toBe('$0.00')
  })

  it('prints the same word for every figure on a restricted view, so no amount can be inferred', () => {
    expect(figureText(amount(8000), true)).toBe(RESTRICTED_FIGURE)
    expect(figureText(amount(0), true)).toBe(RESTRICTED_FIGURE)
    expect(figureText(notRecorded, true)).toBe(RESTRICTED_FIGURE)
  })
})

describe('figureIsKnown', () => {
  it('is true only for a value a restricted caller is allowed to see', () => {
    expect(figureIsKnown(amount(1))).toBe(true)
    expect(figureIsKnown(unknown)).toBe(false)
    expect(figureIsKnown(amount(1), true)).toBe(false)
  })
})

describe('overrunSentence', () => {
  it('names the pool, the forecast, the available amount and the period', () => {
    expect(overrunSentence(fullFigures)).toBe('Takes Core (flexible) to $8,640.00 of $8,000.00 for Oct–Dec 2026.')
  })

  it('does not put a blank in a refusal when the forecast is not available', () => {
    const sentence = overrunSentence(emptyFigures)
    expect(sentence).toContain('the forecast is not available')
    expect(sentence).not.toMatch(/to\s+of\s/)
    expect(sentence).not.toMatch(/\$\s/)
  })

  it('still says which pool and period, so a coordinator knows what is being refused', () => {
    expect(overrunSentence(emptyFigures)).toContain('Core (flexible)')
    expect(overrunSentence(emptyFigures)).toContain('Oct–Dec 2026')
  })

  it('prints a zero overrun as a zero, not as an en dash', () => {
    expect(overrunSentence(zeroFigures)).toContain('$0.00')
  })

  it('shows no amount at all on a restricted view', () => {
    const sentence = overrunSentence(restrictedFigures)
    expect(sentence).not.toMatch(/\$/)
    expect(sentence).toContain('hidden on this account')
  })
})
