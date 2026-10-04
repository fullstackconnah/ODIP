// The pure rules, pinned without a DOM: which paths a caller authorises, what counts as a reason,
// and the two sentences that must never imply the server is on this side of the fence.

import { describe, it, expect } from 'vitest'
import {
  BUDGET_FINDING_CODES,
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
  type BudgetFindingView,
  type BudgetOverrideChoice,
} from './budgetOverrideTypes'
import { RESTRICTED_FIGURE, figureIsKnown, figureText, overrunSentence } from './budgetFigures'
import {
  GOOD_EMERGENCY_REASON,
  SHORT_REASON,
  adminCapabilities,
  amount,
  approachingFinding,
  coordinatorCapabilities,
  emptyFigures,
  forecastOverFinding,
  fullFigures,
  noPathCapabilities,
  notRecorded,
  restrictedFigures,
  unknown,
  zeroFigures,
} from './fixtures'

/**
 * The wiring recipe exactly as README.md documents it, kept in one place so the tests exercise the
 * documented path rather than a paraphrase of it. It is a function (not an inline const) so the
 * `choice` stays the `BudgetOverrideChoice` union: an inline `const choice = 'adminOverride' as const`
 * narrows to that one literal, and the recipe's own `choice === 'emergency'` test then becomes a
 * comparison between two types with no overlap, which is a compile error, not a realistic caller.
 */
function readmeAcknowledgedCodes(
  warningFindings: BudgetFindingView[],
  choice: BudgetOverrideChoice,
): string[] {
  return [
    ...warningFindings.map(f => f.code),
    ...(choice === 'emergency' ? [BUDGET_FINDING_CODES.emergency] : []),
  ]
}

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

  it('maps the forecastOver code itself, not a hard-coded string, so the constant is the gate', () => {
    expect(markerForAcknowledgedCodes([BUDGET_FINDING_CODES.forecastOver])).toBe('adminOverride')
  })

  // DEF-01 (independent source QA, t_357adf61). An Admin override is an ADMIN'S ACT: it carries
  // an audited written reason, so it can only have happened on a shift that was actually over its
  // recorded budget and the caller answered to it. BUDGET_APPROACHING and BUDGET_OVER are
  // no-reason warnings — a shift that is merely approaching, or that is over on the server but was
  // never pushed past, can never have been overridden. Reading ANY BUDGET_* code as an override
  // therefore forged "Over budget: Admin override" onto a shift nobody overrode: a false entry in
  // a compliance audit record, which is the same class F-16 was raised to prevent.
  it.each([
    ['the approaching warning', BUDGET_FINDING_CODES.approaching],
    ['the over-budget warning', BUDGET_FINDING_CODES.over],
  ])('never forges the Admin override marker from %s alone', (_label, code) => {
    expect(markerForAcknowledgedCodes([code])).toBeNull()
  })

  it('never forges the Admin override marker from a BUDGET_ code this lane does not know', () => {
    // A future server code, or a typo, is not evidence of an override. A prefix match is exactly
    // the route that let an unknown code forge the marker.
    expect(markerForAcknowledgedCodes(['BUDGET_WHATEVER_THE_SERVER_ADDS_NEXT'])).toBeNull()
    expect(markerForAcknowledgedCodes(['BUDGET_EMERGENC'])).toBeNull()
    expect(markerForAcknowledgedCodes(['BUDGET_'])).toBeNull()
  })

  it('ignores the no-reason warnings even when they arrive alongside non-budget codes', () => {
    expect(markerForAcknowledgedCodes([BUDGET_FINDING_CODES.approaching, 'STAFF_LEAVE_PENDING'])).toBeNull()
  })

  it('is null for a whole set of no-reason budget warnings, and never a marker per code', () => {
    const warningOnly = [BUDGET_FINDING_CODES.approaching, BUDGET_FINDING_CODES.over]
    expect(markerForAcknowledgedCodes(warningOnly)).toBeNull()
  })

  it('keeps the genuine override when forecastOver is acknowledged beside a no-reason warning', () => {
    expect(
      markerForAcknowledgedCodes([BUDGET_FINDING_CODES.approaching, BUDGET_FINDING_CODES.forecastOver]),
    ).toBe('adminOverride')
  })

  it('does not care about order, and does not care about a repeated code', () => {
    // DEF-03 (independent source QA): the shared FindingsList keys by code, so two findings on
    // different pools can both be BUDGET_FORECAST_OVER and the caller may pass the duplicate
    // through. The marker must be a function of WHICH codes are present, not how many times, and
    // the duplicate must not change it in either direction.
    expect(
      markerForAcknowledgedCodes([BUDGET_FINDING_CODES.forecastOver, BUDGET_FINDING_CODES.forecastOver]),
    ).toBe('adminOverride')
    expect(
      markerForAcknowledgedCodes([BUDGET_FINDING_CODES.approaching, BUDGET_FINDING_CODES.approaching]),
    ).toBeNull()
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

  it('keeps the emergency precedence when a no-reason warning is mixed in as well', () => {
    // The emergency is the stronger, later fact. A no-reason warning alongside it changes
    // nothing, and the warnings must not be able to talk the emergency out of its marker.
    expect(
      markerForAcknowledgedCodes([
        BUDGET_FINDING_CODES.emergency,
        BUDGET_FINDING_CODES.approaching,
        BUDGET_FINDING_CODES.over,
      ]),
    ).toBe('emergency')
    expect(
      markerForAcknowledgedCodes([
        BUDGET_FINDING_CODES.approaching,
        BUDGET_FINDING_CODES.emergency,
        'BUDGET_WHATEVER_THE_SERVER_ADDS_NEXT',
      ]),
    ).toBe('emergency')
  })

  it('reads the README wiring recipe as written: an Admin override of a forecast overrun', () => {
    // README's documented save, followed literally: the caller's warning findings are
    // acknowledged, the choice is an ordinary Admin override, so only the emergency code would be
    // added. The marker must be the Admin override, because forecastOver was acknowledged.
    const acknowledgedFindingCodes = readmeAcknowledgedCodes(
      [approachingFinding, forecastOverFinding],
      'adminOverride',
    )
    expect(acknowledgedFindingCodes).toEqual(['BUDGET_APPROACHING', 'BUDGET_FORECAST_OVER'])
    expect(markerForAcknowledgedCodes(acknowledgedFindingCodes)).toBe('adminOverride')
  })

  it('reads the same recipe on the emergency path and gets the emergency marker', () => {
    const acknowledgedFindingCodes = readmeAcknowledgedCodes(
      [approachingFinding, forecastOverFinding],
      'emergency',
    )
    expect(acknowledgedFindingCodes).toEqual([
      'BUDGET_APPROACHING',
      'BUDGET_FORECAST_OVER',
      'BUDGET_EMERGENCY',
    ])
    expect(markerForAcknowledgedCodes(acknowledgedFindingCodes)).toBe('emergency')
  })

  it('reads a merely-approaching shift through the same recipe and forges nothing', () => {
    // The exact DEF-01 reproduction: the README recipe applied to a shift that is only APPROACHING
    // its budget. No reason was ever required, so no override can be claimed for it.
    const acknowledgedFindingCodes = readmeAcknowledgedCodes([approachingFinding], 'adminOverride')
    expect(acknowledgedFindingCodes).toEqual(['BUDGET_APPROACHING'])
    expect(markerForAcknowledgedCodes(acknowledgedFindingCodes)).toBeNull()
  })

  it('never reads the reason text: only the codes it is given', () => {
    // There is no reason parameter at all, which is the point: a caller cannot pass free text
    // in by accident, and cannot bypass the code by parsing one out of a string.
    expect(markerForAcknowledgedCodes.length).toBe(1)
  })

  it('forges no marker for a shift that never went over budget at all', () => {
    // The marker is an audit claim. A shift with no forecastOver and no emergency code carries
    // neither, whatever else is on the save.
    const codes = [BUDGET_FINDING_CODES.approaching, 'COMPATIBILITY_EXCLUDED', 'BUDGET_UNKNOWN']
    expect(markerForAcknowledgedCodes(codes)).toBeNull()
    expect(markerForAcknowledgedCodes(codes)).not.toBe('adminOverride')
  })

  it('exposes exactly the two markers, so no third invented marker can be rendered', () => {
    expect(Object.keys(OVER_BUDGET_MARKER).sort()).toEqual(['adminOverride', 'emergency'])
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
