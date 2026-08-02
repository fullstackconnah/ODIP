import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStaff, useSettings, useUpdateStaff } from '@/api/hooks'
import { DataTable } from '@/components/DataTable'
import { TabNav } from '@/components/TabNav'
import { StatusBadge } from '@/components/StatusBadge'
import { Card } from '@/components/Card'
import { usePermissions } from '@/lib/permissions'

type QualStatus = 'expired' | 'expiring' | 'no-date' | 'ok'
type FilterTab = 'all' | 'expired' | 'expiring' | 'no-date'

interface QualRow {
  key: string
  staffId: string
  staffName: string
  qualification: string
  fieldKey: string
  expiryDate: string | null
  daysUntilExpiry: number | null
  status: QualStatus
}

interface StaffGroup {
  staffId: string
  staffName: string
  issueCount: number
  rows: QualRow[]
}

const QUALS = [
  { label: 'First Aid', flag: 'isFirstAidQualified', field: 'firstAidExpiryDate' },
  { label: 'Driver Licence', flag: 'isDriverEligible', field: 'driverLicenceExpiryDate' },
  { label: 'Manual Handling', flag: 'isManualHandlingCompetent', field: 'manualHandlingExpiryDate' },
  { label: 'Medication Competency', flag: 'isMedicationCompetent', field: 'medicationCompetencyExpiryDate' },
] as const

function buildGroups(staff: any[], warningDays: number): StaffGroup[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const groups: StaffGroup[] = []

  for (const s of staff) {
    const rows: QualRow[] = []
    let issueCount = 0

    for (const q of QUALS) {
      if (!s[q.flag]) continue
      const expiryDate = s[q.field] as string | null
      let status: QualStatus
      let daysUntilExpiry: number | null = null

      if (!expiryDate) {
        status = 'no-date'
        issueCount++
      } else {
        const expiry = new Date(expiryDate + 'T00:00:00')
        expiry.setHours(0, 0, 0, 0)
        const diff = Math.floor((expiry.getTime() - today.getTime()) / 86400000)
        daysUntilExpiry = diff
        if (diff < 0) { status = 'expired'; issueCount++ }
        else if (diff <= warningDays) { status = 'expiring'; issueCount++ }
        else { status = 'ok' }
      }

      rows.push({
        key: `${s.id}-${q.field}`,
        staffId: s.id,
        staffName: s.fullName,
        qualification: q.label,
        fieldKey: q.field,
        expiryDate,
        daysUntilExpiry,
        status,
      })
    }

    if (issueCount > 0) {
      groups.push({ staffId: s.id, staffName: s.fullName, issueCount, rows })
    }
  }

  // Sort: most issues first
  groups.sort((a, b) => b.issueCount - a.issueCount)
  return groups
}

function getStatusInfo(row: QualRow): { label: string; status: string } {
  if (row.status === 'expired') return { label: 'EXPIRED', status: 'Cancelled' }
  if (row.status === 'no-date') return { label: 'No date set', status: 'Draft' }
  if (row.status === 'ok') return { label: 'Current', status: 'Confirmed' }
  const days = row.daysUntilExpiry!
  const label = days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'}`
  return { label, status: 'Pending' }
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

  const filteredGroups = filterTab === 'all'
    ? groups
    : groups.filter(g => g.rows.some(r => r.status === filterTab))

  const counts = {
    all: groups.length,
    expired: groups.filter(g => g.rows.some(r => r.status === 'expired')).length,
    expiring: groups.filter(g => g.rows.some(r => r.status === 'expiring')).length,
    'no-date': groups.filter(g => g.rows.some(r => r.status === 'no-date')).length,
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
      email: s.email ?? undefined,
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Staff Qualification Expiry</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Warning window: {warningDays} days —{' '}
          <Link to="/settings" className="text-[var(--color-primary)] hover:underline">
            change in Settings
          </Link>
        </p>
      </div>

      {/* Filter tabs */}
      <TabNav
        tabs={tabs.map(t => ({ key: t.key, label: t.label }))}
        active={filterTab}
        onChange={(key) => setFilterTab(key as FilterTab)}
        className="overflow-x-auto"
      />

      {/* Empty state */}
      {filteredGroups.length === 0 ? (
        <Card className="p-12 text-center">
          <span className="material-symbols-outlined text-5xl leading-none text-[var(--color-primary)] mb-3 block">check_circle</span>
          <p className="font-semibold text-[var(--color-foreground)]">All qualifications are current</p>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            No issues found within the {warningDays}-day warning window
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map(group => (
            <div key={group.staffId} className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] overflow-hidden">
              {/* Accordion header */}
              <div
                onClick={() => toggleGroup(group.staffId)}
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-[var(--color-accent)]/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[var(--color-muted-foreground)] text-lg">
                    {expandedIds.has(group.staffId) ? 'expand_less' : 'expand_more'}
                  </span>
                  <span className="font-medium">{group.staffName}</span>
                </div>
                <StatusBadge status="Cancelled" label={`${group.issueCount} issue${group.issueCount !== 1 ? 's' : ''}`} />
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
                      q.status === 'expired' ? 'bg-[#ffdad6]/10' :
                      q.status === 'expiring' ? 'bg-[#fef3c7]/10' : ''
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
                                className="border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                              />
                              {saveError && <p className="text-xs text-[#ba1a1a]">{saveError}</p>}
                            </div>
                          ),
                        },
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (q) => {
                          const info = getStatusInfo(q)
                          return <StatusBadge status={info.status} label={info.label} />
                        },
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
