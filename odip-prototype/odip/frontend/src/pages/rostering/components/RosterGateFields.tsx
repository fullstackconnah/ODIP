import { FormField } from '@/components/FormField'
import { FindingsList } from './FindingsList'
import { getRosterGate } from '../lib/rosterGate'
import type { RosterFindingDto } from '@/api/types'

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
  /** Disables the override-reason textarea — mirrors the write-permission check every other field
   * in these forms gets from its caller. Defaults to false (enabled). */
  disabled?: boolean
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
 * (reasonRequiredFindings.length > 0) — a soft Warning finding alone must never summon it on its
 * own — or when forceVisible is set, for a record that already carries a persisted reason a
 * coordinator should be able to read and amend even once the finding that originally required it
 * is gone.
 */
export function RosterGateFields({ findings, overrideReason, onOverrideReasonChange, reasonRequired, forceVisible, disabled }: RosterGateFieldsProps) {
  const { reasonRequiredFindings, blockingFindings } = getRosterGate(findings)
  const showReasonField = reasonRequiredFindings.length > 0 || !!forceVisible

  return (
    <>
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
            rows={2}
            value={overrideReason}
            disabled={disabled}
            onChange={e => onOverrideReasonChange(e.target.value)}
            placeholder="Why this assignment should proceed despite the warnings above"
          />
        </FormField>
      )}

      {blockingFindings.length > 0 && (
        <p role="alert" className="text-sm font-medium text-destructive">
          This assignment can't be saved while a blocking finding is open.
        </p>
      )}
    </>
  )
}
