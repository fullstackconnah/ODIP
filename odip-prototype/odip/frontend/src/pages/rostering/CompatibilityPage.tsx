import { useMemo, useState } from 'react'
import { AlertTriangle, Pencil, Users } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { usePermissions } from '@/lib/permissions'
import { useParticipants, useStaff, useUpsertCompatibility } from '@/api/hooks'
import type { CompatibilityLevel, CompatibilityRowDto } from '@/api/types'
import { useCompatibilityMatrix } from './lib/useCompatibilityMatrix'

type PersonRef = { id: string; fullName: string }

type ExcludeDraft = {
  staff: PersonRef
  participant: PersonRef
  reason: string
}

function cellKey(staffId: string, participantId: string): string {
  return `${staffId}:${participantId}`
}

// The full dropdown, revealed on hover/focus for editing: solid, saturated, unambiguous —
// the moment you're interacting with a cell you get the real control with its native chrome.
const LEVEL_SELECT_CLASS: Record<CompatibilityLevel, string> = {
  Allowed: 'bg-surface-container text-muted-foreground',
  Preferred: 'bg-primary-fixed text-on-primary-fixed font-medium',
  Excluded: 'bg-error-container text-on-error-container font-medium',
}

// What a cell shows AT REST, before any hover/focus — quiet but never hidden. Preferred and
// Excluded are the exceptions worth reading without interacting, so they keep a label, just at
// accent weight (~10% tint) rather than the full-saturation fill reserved for the active
// dropdown. Excluded carries more weight than Preferred (stronger tint, semibold) since it's
// the state that stops a roster. Allowed — the sparse, uninformative default — gets no label;
// "editable but empty" is itself the signal, backed by the cell's hairline underline.
const RESTING_LABEL_CLASS: Record<CompatibilityLevel, string> = {
  Allowed: '',
  Preferred: 'rounded-full bg-primary/10 px-2 py-0.5 text-[11px] leading-none text-primary',
  Excluded: 'rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold leading-none text-destructive',
}

// Read-only (non-writer) rendering shares the same resting weight — there's nothing to reveal
// on hover since there's no control underneath, so this IS the permanent state for viewers.
function RestingMark({ level }: { level: CompatibilityLevel }) {
  if (level === 'Allowed') return null
  return <span className={RESTING_LABEL_CLASS[level]}>{level}</span>
}

/** Loading state — a skeleton matching the final matrix's shape, no spinner. */
function CompatibilityMatrixSkeleton() {
  return (
    <div className="overflow-x-auto rounded-lg border border-border" aria-hidden="true">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-border bg-surface-container-low p-2" />
            {Array.from({ length: 6 }, (_, i) => (
              <th key={i} className="border-b border-border bg-surface-container-low p-2">
                <div className="h-3 w-16 animate-pulse rounded-sm bg-muted" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, rowIdx) => (
            <tr key={rowIdx} className="border-b border-border">
              <td className="sticky left-0 z-10 border-r border-border bg-card p-2">
                <div className="h-3 w-24 animate-pulse rounded-sm bg-muted" />
              </td>
              {Array.from({ length: 6 }, (_, colIdx) => (
                <td key={colIdx} className="p-2 text-center">
                  <div className="mx-auto h-4 w-16 animate-pulse rounded-full bg-muted" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CompatibilityPage() {
  const { canWrite } = usePermissions()
  // INTAKE-08: the compatibility matrix excludes drafts.
  const { data: participants = [], isLoading: participantsLoading, isError: participantsError, refetch: refetchParticipants } = useParticipants({ isDraft: 'false' })
  const { data: staff = [], isLoading: staffLoading, isError: staffError, refetch: refetchStaff } = useStaff()

  // PP-53: text filters on a matrix that can otherwise grow unbrowsably wide/tall.
  const [staffFilter, setStaffFilter] = useState('')
  const [participantFilter, setParticipantFilter] = useState('')
  const filteredStaff = useMemo(
    () => staff.filter(s => s.fullName.toLowerCase().includes(staffFilter.trim().toLowerCase())),
    [staff, staffFilter],
  )
  const filteredParticipants = useMemo(
    () => participants.filter(p => p.fullName.toLowerCase().includes(participantFilter.trim().toLowerCase())),
    [participants, participantFilter],
  )

  const participantIds = useMemo(() => participants.map(p => p.id), [participants])
  const matrix = useCompatibilityMatrix(participantIds)
  const upsertCompatibility = useUpsertCompatibility()

  // Optimistic overlay: cell edits apply here immediately and clear once the server confirms
  // (or roll back — removed here, tracked in failedKeys — on failure).
  const [overrides, setOverrides] = useState<Map<string, CompatibilityRowDto>>(new Map())
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set())
  const [excludeDraft, setExcludeDraft] = useState<ExcludeDraft | null>(null)

  const isLoading = participantsLoading || staffLoading || matrix.isLoading
  const isError = participantsError || staffError || matrix.isError

  function resolveCell(staffId: string, participantId: string): { level: CompatibilityLevel; reason: string | null } {
    const key = cellKey(staffId, participantId)
    const row = overrides.get(key) ?? matrix.byKey.get(key)
    return { level: row?.level ?? 'Allowed', reason: row?.reason ?? null }
  }

  function applyChange(staffRef: PersonRef, participantRef: PersonRef, level: CompatibilityLevel, reason: string | null) {
    const key = cellKey(staffRef.id, participantRef.id)

    setOverrides(prev => new Map(prev).set(key, {
      staffId: staffRef.id,
      staffName: staffRef.fullName,
      participantId: participantRef.id,
      participantName: participantRef.fullName,
      level,
      reason,
      updatedAt: new Date().toISOString(),
    }))
    setFailedKeys(prev => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })

    upsertCompatibility.mutate(
      { staffId: staffRef.id, participantId: participantRef.id, level, reason },
      {
        onSuccess: () => {
          setOverrides(prev => {
            const next = new Map(prev)
            next.delete(key)
            return next
          })
        },
        onError: () => {
          // Roll back to whatever the server last confirmed for this cell.
          setOverrides(prev => {
            const next = new Map(prev)
            next.delete(key)
            return next
          })
          setFailedKeys(prev => new Set(prev).add(key))
          setTimeout(() => {
            setFailedKeys(prev => {
              if (!prev.has(key)) return prev
              const next = new Set(prev)
              next.delete(key)
              return next
            })
          }, 4000)
        },
      },
    )
  }

  function handleLevelChange(staffRef: PersonRef, participantRef: PersonRef, level: CompatibilityLevel) {
    if (level === 'Excluded') {
      const current = resolveCell(staffRef.id, participantRef.id)
      setExcludeDraft({ staff: staffRef, participant: participantRef, reason: current.reason ?? '' })
      return
    }
    applyChange(staffRef, participantRef, level, null)
  }

  function handleConfirmExclude() {
    if (!excludeDraft) return
    applyChange(excludeDraft.staff, excludeDraft.participant, 'Excluded', excludeDraft.reason.trim() || null)
    setExcludeDraft(null)
  }

  const noPeopleYet = !isLoading && !isError && (staff.length === 0 || participants.length === 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Staff–participant compatibility"
        subtitle="Preferred and excluded pairings the roster board and conflict checks use when suggesting or warning about a match."
      />

      {isLoading && <CompatibilityMatrixSkeleton />}

      {!isLoading && isError && (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load the compatibility matrix"
          description="Something went wrong fetching staff, participants, or their compatibility. Try again."
          action={{ label: 'Retry', onClick: () => { refetchParticipants(); refetchStaff(); matrix.refetchAll() } }}
        />
      )}

      {noPeopleYet && (
        <EmptyState
          icon={Users}
          title="Nothing to match yet"
          description="This matrix is how the roster board knows who works well with whom — mark a pairing Preferred to nudge assignment toward it, or Excluded to keep it out of the board's suggestions and raise a warning if someone rosters it anyway. It needs at least one staff member and one participant before there's anything to mark."
        />
      )}

      {!isLoading && !isError && !noPeopleYet && (
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
            placeholder="Filter staff…"
            aria-label="Filter staff"
            className="w-48 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            value={participantFilter}
            onChange={e => setParticipantFilter(e.target.value)}
            placeholder="Filter participants…"
            aria-label="Filter participants"
            className="w-48 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}

      {!isLoading && !isError && !noPeopleYet && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 whitespace-nowrap border-b border-r border-border bg-surface-container-low px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Staff
                </th>
                {filteredParticipants.map(participant => (
                  <th
                    key={participant.id}
                    className="sticky top-0 z-20 min-w-[7rem] whitespace-nowrap border-b border-border bg-surface-container-low px-2 py-2 text-left text-xs font-medium text-muted-foreground"
                  >
                    {participant.fullName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredStaff.map(staffMember => (
                <tr key={staffMember.id}>
                  <td className="sticky left-0 z-10 whitespace-nowrap border-r border-border bg-card px-3 py-1 text-sm font-medium text-foreground">
                    {staffMember.fullName}
                  </td>
                  {filteredParticipants.map(participant => {
                    const staffRef: PersonRef = { id: staffMember.id, fullName: staffMember.fullName }
                    const participantRef: PersonRef = { id: participant.id, fullName: participant.fullName }
                    const { level, reason } = resolveCell(staffMember.id, participant.id)
                    const failed = failedKeys.has(cellKey(staffMember.id, participant.id))
                    const accessibleName = `${staffMember.fullName} with ${participant.fullName}: ${level}`

                    return (
                      <td key={participant.id} className="px-1.5 py-1 text-center align-middle" title={reason ?? undefined}>
                        {canWrite ? (
                          <div
                            className={`group relative inline-flex h-6 min-w-[1.5rem] items-center justify-center gap-1 ${
                              level === 'Allowed'
                                ? 'border-b border-dashed border-border transition-colors duration-100 hover:border-transparent focus-within:border-transparent'
                                : ''
                            }`}
                          >
                            {/* Resting mark: the permanent, low-weight affordance — a visible label for the
                                exceptions, a bare hairline underline for Allowed. Fades out once hover/focus
                                reveals the real control underneath. Decorative — the select carries the
                                actual accessible name and interaction. */}
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0"
                            >
                              <RestingMark level={level} />
                            </span>
                            <select
                              aria-label={accessibleName}
                              value={level}
                              onChange={e => handleLevelChange(staffRef, participantRef, e.target.value as CompatibilityLevel)}
                              className={`relative z-10 appearance-none rounded-full px-2 py-0.5 text-xs opacity-0 transition-opacity duration-100 hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 ${LEVEL_SELECT_CLASS[level]}`}
                            >
                              <option value="Preferred">Preferred</option>
                              <option value="Allowed">Allowed</option>
                              <option value="Excluded">Excluded</option>
                            </select>
                            {level === 'Excluded' && (
                              <button
                                type="button"
                                onClick={() => setExcludeDraft({ staff: staffRef, participant: participantRef, reason: reason ?? '' })}
                                aria-label={`Edit exclusion reason for ${staffMember.fullName} with ${participant.fullName}`}
                                title="Edit reason"
                                className="relative z-10 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity duration-100 hover:bg-accent hover:text-foreground focus:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                            {failed && (
                              <span title="Couldn't save — try again." className="relative z-10 inline-flex">
                                <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                              </span>
                            )}
                          </div>
                        ) : (
                          <span aria-label={accessibleName} className="inline-flex h-6 min-w-[1.5rem] items-center justify-center">
                            <RestingMark level={level} />
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={excludeDraft !== null}
        onCancel={() => setExcludeDraft(null)}
        title="Exclude from roster matching"
        message={excludeDraft && (
          <>
            <p>
              <strong className="text-foreground">{excludeDraft.staff.fullName}</strong> won't be suggested for{' '}
              <strong className="text-foreground">{excludeDraft.participant.fullName}</strong>'s shifts. Shifts already rostered aren't
              touched, and rostering this pairing anyway still works — it just raises a warning the coordinator can override.
            </p>
            <FormField label="Reason" required hint="Stored with the exclusion and visible in audit.">
              <textarea
                rows={2}
                value={excludeDraft.reason}
                onChange={e => setExcludeDraft(draft => draft && { ...draft, reason: e.target.value })}
                placeholder="Why this pairing is excluded"
              />
            </FormField>
          </>
        )}
        footer={
          <>
            <button
              type="button"
              onClick={() => setExcludeDraft(null)}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!excludeDraft?.reason.trim()}
              onClick={handleConfirmExclude}
              className="px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              Exclude
            </button>
          </>
        }
      />
    </div>
  )
}
