import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStaff, useSettings, useUpdateStaff } from '@/api/hooks'
import { DataTable } from '@/components/DataTable'
import { Tabs } from '@/components/Tabs'
import { StatusBadge } from '@/components/StatusBadge'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { UserCog } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { staffCredentials, credentialIssueCount } from '@/lib/credentials'
import { DEADLINE_TONE, deadlineLabel, type DeadlineState, type DeadlineStatus } from '@/lib/deadline'
import { plural } from '@/lib/format'
import type { StaffListDto } from '@/api/types/staff'

type FilterTab = 'all' | 'expired' | 'expiring' | 'no-date'

interface QualRow {
  key: string
  staffId: string
  staffName: string
  qualification: string
  fieldKey: string
  expiryDate: string | null
  state: DeadlineState
}

interface StaffGroup {
  staffId: string
  staffName: string
  issueCount: number
  rows: QualRow[]
}

// Which deadline states each filter tab lists ("Expiring Soon" includes a credential that expires today).
const FILTER_STATES: Record<Exclude<FilterTab, 'all'>, DeadlineStatus[]> = {
  expired: ['overdue'],
  expiring: ['today', 'soon'],
  'no-date': ['none'],
}

// Which credentials apply, and what state each is in, is lib/credentials.ts: the same rule the Dashboard's "Qualification Issues" count
// and a staff member's Credentials tab use, so the three cannot disagree.
function buildGroups(staff: StaffListDto[], warningDays: number): StaffGroup[] {
  const today = new Date()
  const groups: StaffGroup[] = []

  for (const s of staff) {
    const credentials = staffCredentials(s, { warnDays: warningDays, today })
    const issueCount = credentialIssueCount(credentials)
    if (issueCount === 0) continue

    groups.push({
      staffId: s.id,
      staffName: s.fullName,
      issueCount,
      rows: credentials.map(c => ({
        key: `${s.id}-${c.field}`,
        staffId: s.id,
        staffName: s.fullName,
        qualification: c.label,
        fieldKey: c.field,
        expiryDate: c.expiryDate,
        state: c.state,
      })),
    })
  }

  // Sort: most issues first
  groups.sort((a, b) => b.issueCount - a.issueCount)
  return groups
}

export default function QualificationsPage() {
  const { canWrite } = usePermissions()
  const { data: settings } = useSettings()
  const { data: allStaff = [], isLoading } = useStaff({ isActive: 'true' })
  const updateStaff = useUpdateStaff()

  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const warningDays = settings?.qualificationWarningDays ?? 30
  const groups = buildGroups(allStaff, warningDays)

  const hasRowIn = (g: StaffGroup, tab: Exclude<FilterTab, 'all'>) => g.rows.some(r => FILTER_STATES[tab].includes(r.state.status))

  const filteredGroups = filterTab === 'all'
    ? groups
    : groups.filter(g => hasRowIn(g, filterTab))

  const counts = {
    all: groups.length,
    expired: groups.filter(g => hasRowIn(g, 'expired')).length,
    expiring: groups.filter(g => hasRowIn(g, 'expiring')).length,
    'no-date': groups.filter(g => hasRowIn(g, 'no-date')).length,
  }

  function toggleGroup(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleEdit(row: QualRow) {
    setEditingKey(row.key)
    setEditValue(row.expiryDate ?? '')
    setSaveError(null)
  }

  function handleSave(row: QualRow) {
    const s = allStaff.find((m: any) => m.id === row.staffId)
    if (!s) return

    const payload = {
      firstName: s.firstName,
      lastName: s.lastName,
      role: s.role,
      position: s.position,
      email: s.email ?? '',
      mobile: s.mobile ?? undefined,
      region: s.region ?? undefined,
      isDriverEligible: s.isDriverEligible,
      isFirstAidQualified: s.isFirstAidQualified,
      isMedicationCompetent: s.isMedicationCompetent,
      isManualHandlingCompetent: s.isManualHandlingCompetent,
      isOvernightEligible: s.isOvernightEligible,
      isActive: s.isActive,
      notes: s.notes ?? undefined,
      firstAidExpiryDate: s.firstAidExpiryDate ?? undefined,
      driverLicenceExpiryDate: s.driverLicenceExpiryDate ?? undefined,
      manualHandlingExpiryDate: s.manualHandlingExpiryDate ?? undefined,
      medicationCompetencyExpiryDate: s.medicationCompetencyExpiryDate ?? undefined,
      workerScreeningNumber: s.workerScreeningNumber ?? undefined,
      workerScreeningExpiryDate: s.workerScreeningExpiryDate ?? undefined,
      [row.fieldKey]: editValue || undefined,
    }

    updateStaff.mutate({ id: row.staffId, data: payload }, {
      onSuccess: () => { setEditingKey(null); setSaveError(null) },
      onError: () => setSaveError('Failed to save. Please try again.'),
    })
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: `All Issues (${counts.all})` },
    { key: 'expired', label: `Expired (${counts.expired})` },
    { key: 'expiring', label: `Expiring Soon (${counts.expiring})` },
    { key: 'no-date', label: `No Date Set (${counts['no-date']})` },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (allStaff.length === 0) {
    return (
      <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
        <PageHeader
          title="Staff Qualification Expiry"
          subtitle={(
            <>
              Warning window: {warningDays} days —{' '}
              <Link to="/settings" className="text-[var(--color-primary)] hover:underline">
                change in Settings
              </Link>
              {' '}· showing active staff only
            </>
          )}
        />
        <EmptyState
          icon={UserCog}
          title="No staff members yet"
          description="This page tracks expiry dates for staff certifications like First Aid, driver licences, and manual handling. Add a staff member to start tracking theirs."
          action={canWrite ? { label: 'Add staff member', to: '/staff/new' } : undefined}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Staff Qualification Expiry"
        subtitle={(
          <>
            Warning window: {warningDays} days —{' '}
            <Link to="/settings" className="text-[var(--color-primary)] hover:underline">
              change in Settings
            </Link>
            {' '}· showing active staff only
          </>
        )}
      />

      {/* Filter tabs */}
      <Tabs
        tabs={tabs.map(t => ({ id: t.key, label: t.label }))}
        active={filterTab}
        onChange={(key) => setFilterTab(key as FilterTab)}
        ariaLabel="Qualification filters"
      />

      {/* Empty state */}
      {filteredGroups.length === 0 ? (
        <Card className="p-[var(--card-pad)] text-center">
          <span className="material-symbols-outlined text-5xl leading-none text-[var(--color-primary)] mb-3 block">check_circle</span>
          <p className="font-semibold text-[var(--color-foreground)]">All qualifications are current</p>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            No issues found within the {warningDays}-day warning window
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map(group => (
            <div key={group.staffId} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
              {/* Accordion header — a flex row of TWO sibling interactive elements, never one
                  nested inside the other: the native <button> (chevron + name) toggles the
                  accordion, and a separate Link navigates to the staff record. */}
              <div className="flex w-full items-center gap-3 p-[var(--card-pad)] hover:bg-[var(--color-accent)]/50 transition-colors">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.staffId)}
                  className="flex flex-1 min-w-0 items-center gap-3 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-sm"
                >
                  <span className="material-symbols-outlined text-[var(--color-muted-foreground)] text-lg">
                    {expandedIds.has(group.staffId) ? 'expand_less' : 'expand_more'}
                  </span>
                  <span className="font-medium truncate">{group.staffName}</span>
                </button>
                <StatusBadge tone="danger" label={plural(group.issueCount, 'issue')} />
                <Link
                  to={`/staff/${group.staffId}/edit`}
                  aria-label={`Edit ${group.staffName}`}
                  className="shrink-0 p-2 -m-2 rounded-lg text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                >
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">edit</span>
                </Link>
              </div>

              {/* Accordion body */}
              {expandedIds.has(group.staffId) && (
                <div className="border-t border-[var(--color-border)]">
                  <DataTable<QualRow>
                    data={group.rows}
                    keyField="key"
                    editingRow={editingKey}
                    onEditChange={(_row, _key, value) => setEditValue(value as string)}
                    compact
                    className="overflow-x-auto"
                    rowClassName={(q) =>
                      q.state.status === 'overdue' ? 'bg-[var(--color-error-container)]/10' :
                      q.state.status === 'today' || q.state.status === 'soon' ? 'bg-[var(--color-warning-container)]/10' : ''
                    }
                    columns={[
                      {
                        key: 'qualification',
                        header: 'Qualification',
                        className: 'text-[var(--color-muted-foreground)]',
                      },
                      {
                        key: 'expiryDate',
                        header: 'Expiry Date',
                        type: 'date',
                        editable: {
                          render: (_q, onChange) => (
                            <div className="space-y-1">
                              <input
                                type="date"
                                value={editValue}
                                onChange={e => onChange(e.target.value)}
                                aria-label="Expiry date"
                                className="border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                              />
                              {saveError && <p className="text-xs text-[var(--color-destructive)]">{saveError}</p>}
                            </div>
                          ),
                        },
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (q) => <StatusBadge tone={DEADLINE_TONE[q.state.status]} label={deadlineLabel(q.state, 'long')} />,
                      },
                      {
                        key: 'actions',
                        header: '',
                        align: 'right' as const,
                        render: (q) => {
                          const isEditing = editingKey === q.key
                          return isEditing ? (
                            <div className="flex items-center gap-3 justify-end">
                              <button
                                onClick={() => handleSave(q)}
                                disabled={updateStaff.isPending}
                                className="text-xs font-semibold text-[var(--color-primary)] hover:underline disabled:opacity-50"
                              >
                                {updateStaff.isPending ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditingKey(null); setSaveError(null) }}
                                className="text-xs text-[var(--color-muted-foreground)] hover:underline"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : canWrite ? (
                            <button
                              onClick={() => handleEdit(q)}
                              className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                            >
                              Edit
                            </button>
                          ) : null
                        },
                      },
                    ]}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
