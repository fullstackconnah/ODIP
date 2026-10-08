import { useEffect, useRef } from 'react'
import { FormField } from '@/components/FormField'
import { FindingsList } from './FindingsList'
import { getRosterGate } from '../lib/rosterGate'
import type { RosterFindingDto } from '@/api/types'
import { plural } from '@/lib/format'

export interface RosterGateFieldsProps {
  findings: RosterFindingDto[]
  overrideReason: string
  onOverrideReasonChange: (value: string) => void
  reasonRequired: boolean
  /**
   * Keep the override-reason field visible (though optional) even with no live reason-required
   * finding — e.g. a persisted overrideReason on an existing record that should stay visible and
   * editable whenever the record is reopened, so a coordinator can read/amend why an override was
   * made. Defaults to false, which preserves today's behaviour at the 3 existing call sites.
   */
  forceVisible?: boolean
  /**
   * Show the override-reason field (optional — `required` stays keyed to reasonRequiredFindings
   * only) whenever ANY Warning-severity finding is present, not just a reason-required one — a
   * Blocking-only findings set does NOT trigger this (Blocking already refuses the save outright,
   * so there's nothing to leave a voluntary note about). The roster board (ShiftSlideOver) sets
   * this: it has always invited a voluntary override note on any warning, and in an NDIS context
   * that note is audit evidence, so this behaviour is deliberate there. The trip-side call sites
   * (StaffAssignModal, StaffTab) do NOT set this — trip-side assignment only asks for a reason
   * when a finding actually demands one. The two surfaces differ on purpose; this prop states
   * that decision instead of leaving it as silent drift between them. Defaults to false.
   */
  showOnAnyWarning?: boolean
  /** Disables the override-reason textarea — mirrors the write-permission check every other field
   * in these forms gets from its caller. Defaults to false (enabled). */
  disabled?: boolean
  /**
   * Every Blocking finding on the list has been answered by another control on the form (the shift panel's "Emergency or safety" choice, once its description is real), so the standing sentence
   * "can't be saved while a blocking finding is open" is not said: it would contradict a Save button that now works. The findings themselves still print, and still count in the live announcement.
   * Defaults to false: today's behaviour at every other call site.
   */
  blockingAnswered?: boolean
}

/**
 * The findings list + conditional override-reason field + blocking-finding message every
 * roster-checked write form renders around its own fields. Shared by StaffAssignModal (the
 * "Assign Staff" modal, schedule page), both of StaffTab's modals (Add Staff and inline "Edit
 * Assignment", trip detail page), and ShiftSlideOver (the roster board's create/edit panel) so the
 * forms can't drift — see docs/specs/2026-09-07-staff-leave-unavailability-design.md §3. Built on
 * the shared FormField so the override-reason control gets the same aria-required/aria-invalid/
 * aria-describedby wiring every other field in these forms gets.
 *
 * The override-reason field shows whenever a live finding actually requires a reason
 * (reasonRequiredFindings.length > 0, in which case it's required) — a soft Warning finding
 * alone must never FORCE it on its own — or when forceVisible is set, for a record that already
 * carries a persisted reason a coordinator should be able to read and amend even once the
 * finding that originally required it is gone — or, when the caller opts in via
 * showOnAnyWarning, whenever any Warning finding is present at all (still optional in that case).
 */
export function RosterGateFields({ findings, overrideReason, onOverrideReasonChange, reasonRequired, forceVisible, showOnAnyWarning, disabled, blockingAnswered }: RosterGateFieldsProps) {
  const { reasonRequiredFindings, blockingFindings } = getRosterGate(findings)
  const hasWarningFinding = findings.some(f => f.severity === 'Warning')
  const showReasonField = reasonRequiredFindings.length > 0 || !!forceVisible || (!!showOnAnyWarning && hasWarningFinding)

  const reasonTextareaRef = useRef<HTMLTextAreaElement>(null)
  const wasReasonRequiredRef = useRef(reasonRequired)
  // Move focus to the reason textarea on a failed save (reasonRequired flips false -> true) so a
  // screen-reader or keyboard user isn't left with silence and focus stuck wherever it was. Only
  // fires on that transition — never on first render (wasReasonRequiredRef starts at the initial
  // value, so an already-true initial state doesn't steal focus) and never again while the error
  // stays showing, since the ref is updated every run regardless of whether focus moved.
  useEffect(() => {
    if (reasonRequired && !wasReasonRequiredRef.current) {
      reasonTextareaRef.current?.focus()
    }
    wasReasonRequiredRef.current = reasonRequired
  }, [reasonRequired])

  return (
    <>
      {/* Findings arrive from an async server-side conflict check (POST /shifts/check and
          equivalents), which otherwise gives a screen-reader user no signal that a check ran or
          that conflicts appeared/cleared. This sr-only live region announces just that change —
          a count/severity summary, not the finding text itself (that's already reachable via the
          visible FindingsList right below, in normal reading order) — whenever the findings
          count actually updates. Polite, not assertive: a conflict finding here is something to
          review, not an emergency interrupt. No role="status" here deliberately — callers (e.g.
          ShiftSlideOver's staff-compatibility notice) already use role="status" for their own
          single non-blocking notice and assert on there being exactly one/zero status elements. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {findings.length === 0
          ? 'Roster check complete: no conflicts found.'
          : `Roster check complete: ${plural(findings.length, 'finding')}` +
            (blockingFindings.length > 0 ? `, ${blockingFindings.length} blocking` : '') + '.'}
      </div>

      {findings.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Findings</p>
          <FindingsList findings={findings} />
        </div>
      )}

      {showReasonField && (
        <FormField
          label="Reason for override"
          required={reasonRequiredFindings.length > 0}
          error={reasonRequired ? 'A reason is required to save over the warnings marked “Reason required”.' : undefined}
        >
          <textarea
            ref={reasonTextareaRef}
            rows={2}
            value={overrideReason}
            disabled={disabled}
            onChange={e => onOverrideReasonChange(e.target.value)}
            placeholder="Why this assignment should proceed despite the warnings above"
          />
        </FormField>
      )}

      {blockingFindings.length > 0 && !blockingAnswered && (
        <p role="alert" className="text-sm font-medium text-destructive">
          This assignment can't be saved while a blocking finding is open.
        </p>
      )}
    </>
  )
}
