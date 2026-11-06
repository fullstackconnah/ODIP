import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStaff, useSettings, useUpdateStaff, useProviderSettings } from '@/api/hooks'
import { DataTable } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { ToggleGroup } from '@/components/ToggleGroup'
import { BackButton } from '@/components/BackButton'
import { Callout } from '@/components/Callout'
import { inputClass } from '@/components/FormField'
import { Settings, UserCog, X } from 'lucide-react'
import { Button } from '@/components/Button'
import { usePermissions } from '@/lib/permissions'
import { CREDENTIALS, staffCredentials, credentialIssueCount, type StaffCredential } from '@/lib/credentials'
import { DEADLINE_TONE, deadlineLabel, type DeadlineStatus } from '@/lib/deadline'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { apiGet } from '@/api/client'
import { toUpdateStaffDto, type StaffDetailDto, type StaffListDto } from '@/api/types/staff'
import { retryingAfterError } from '@/lib/queryPhase'

interface QualRow {
  key: string
  staffId: string
  staffName: string
  qualification: string
  fieldKey: string
  expiryDate: string | null
  state: StaffCredential['state']
}

interface Person {
  staff: StaffListDto
  credentials: StaffCredential[]
  issueCount: number
  worst: DeadlineStatus
}

// The worst state wins the dot. A missing date ranks above an expiring one: a worker with no screening date is already blocked on the roster
// (RosterConflictService WSC_MISSING), while an expiring credential still works today.
const WORST_RANK: Record<DeadlineStatus, number> = { overdue: 4, none: 3, today: 2, soon: 1, ok: 0 }
const WORST_WORD: Record<DeadlineStatus, string> = { overdue: 'Expired', none: 'No date set', today: 'Expires today', soon: 'Expiring soon', ok: '' }
// The dot only repeats the words (WCAG 1.4.1). Warning uses its on-container ink: --color-warning is about 2.1:1 on white.
const DOT_CLASS: Record<DeadlineStatus, string> = {
  overdue: 'bg-[var(--color-destructive)]',
  none: 'border-2 border-[var(--color-muted-foreground)]',
  today: 'bg-[var(--color-on-warning-container)]',
  soon: 'bg-[var(--color-on-warning-container)]',
  ok: '',
}

// Which credentials apply, and what state each is in, is lib/credentials.ts: the same rule the Dashboard's "Qualification Issues" count
// and a staff member's Credentials tab use, so the three cannot disagree.
function buildPeople(staff: StaffListDto[], warningDays: number): Person[] {
  const today = new Date()
  return staff
    .filter(s => s.isActive !== false)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map(s => {
      const credentials = staffCredentials(s, { warnDays: warningDays, today })
      const worst = credentials.reduce<DeadlineStatus>((w, c) => (WORST_RANK[c.state.status] > WORST_RANK[w] ? c.state.status : w), 'ok')
      return { staff: s, credentials, issueCount: credentialIssueCount(credentials), worst }
    })
}

export default function QualificationsPage() {
  const { canWrite, canAccessPage } = usePermissions()
  const staffFromPayroll = useProviderSettings(canWrite).data?.employmentHeroConnected === true
  const { data: settings } = useSettings()
  const pageQuery = useStaff({ isActive: 'true' })
  const { data: allStaff = [], isLoading, isError, refetch } = pageQuery
  const updateStaff = useUpdateStaff()
  const belowMd = useIsBelowMd()
  const [params, setParams] = useSearchParams()

  const [query, setQuery] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [badInput, setBadInput] = useState(false) // a half-typed date reads back as '', which must never be saved as a clear
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null) // a save that failed after the user moved to another person
  const [rereading, setRereading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null) // the row whose PUT is in flight; the mutation's own pending flag covers the whole page
  const editSeq = useRef(0) // bumped when an editor opens or closes, so a save still re-reading a record the user has left is dropped
  const headingRef = useRef<HTMLHeadingElement>(null)
  const stepped = useRef(false) // Previous/Next just ran: focus the new name and scroll its row into view

  const warningDays = settings?.qualificationWarningDays ?? 30
  const people = buildPeople(allStaff, warningDays)
  const attention = people.filter(p => p.issueCount > 0)
  const issueTotal = attention.reduce((sum, p) => sum + p.issueCount, 0)

  const onlyAttention = params.get('show') === 'attention'
  const chosen = people.find(p => p.staff.id === params.get('staff'))
  const q = query.trim().toLowerCase()
  // The person on screen stays listed under Needs attention after their last issue is fixed, until you leave them.
  const listed = people.filter(p =>
    (!onlyAttention || p.issueCount > 0 || p === chosen) && (!q || p.staff.fullName.toLowerCase().includes(q)))
  const current = chosen ?? listed[0] // from md up the first person shows without writing the URL
  const index = current ? listed.indexOf(current) : -1
  const previous = index > 0 ? listed[index - 1] : undefined
  const next = index >= 0 ? listed[index + 1] : listed[0]

  const setParam = (key: string, value: string | null) =>
    setParams(p => { const n = new URLSearchParams(p); if (value) n.set(key, value); else n.delete(key); return n }, { replace: true })

  useEffect(() => {
    if (!stepped.current) return
    stepped.current = false
    headingRef.current?.focus()
    document.getElementById(`qual-staff-${current?.staff.id}`)?.scrollIntoView({ block: 'nearest' })
    if (belowMd) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [current?.staff.id, belowMd])

  function closeEditor() {
    editSeq.current++
    setRereading(false)
    setEditingKey(null)
    setSaveError(null)
    setBadInput(false)
  }

  function step(p: Person) {
    closeEditor() // an unsaved typed date is discarded
    stepped.current = true
    setParam('staff', p.staff.id)
  }

  function handleEdit(row: QualRow) {
    editSeq.current++
    setRereading(false)
    setEditingKey(row.key)
    setEditValue(row.expiryDate ?? '')
    setSaveError(null)
    setBadInput(false)
    if (!chosen && current) setParam('staff', current.staff.id) // so the person stays listed under Needs attention once fixed
  }

  async function handleSave(row: QualRow) {
    if (badInput) return
    const cached = allStaff.find((m: any) => m.id === row.staffId)
    if (!cached) return

    // The PUT rewrites the whole record and this page has no Active control, so it is read at save: a deactivation made since the list loaded is
    // not undone. If the re-read fails, the row loaded with the page is sent (never worse than before).
    const seq = editSeq.current
    setRereading(true)
    const s = await apiGet<StaffDetailDto>(`/staff/${row.staffId}`).catch(() => cached)
    if (seq !== editSeq.current) return
    setRereading(false)

    setSavingKey(row.key)
    updateStaff.mutate({ id: row.staffId, data: toUpdateStaffDto(s, { [row.fieldKey]: editValue || undefined }) }, {
      // A save the user has left (editor closed, or another person opened) still refreshes the data but must not touch the editor open now.
      onSuccess: () => { if (seq === editSeq.current) { setEditingKey(null); setSaveError(null) } },
      onError: () => {
        if (seq === editSeq.current) setSaveError('Failed to save. Please try again.')
        else setPageError(`Couldn't save ${row.qualification} for ${row.staffName}. Please try again.`)
      },
      onSettled: () => setSavingKey(k => (k === row.key ? null : k)),
    })
  }

  // Arrow keys move focus only: selection never follows focus, so an arrow press cannot close an open editor. Enter follows the focused link.
  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const links = Array.from(e.currentTarget.querySelectorAll('a'))
    const at = links.indexOf(document.activeElement as HTMLAnchorElement)
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : Math.min(Math.max(at + (e.key === 'ArrowDown' ? 1 : -1), 0), links.length - 1)
    e.preventDefault()
    links[to]?.focus()
  }

  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="staff qualifications" />

  // The Dashboard's "Qualification Issues" figure counts issues; the subtitle says both issues and staff, so 12 reads against 4.
  // ReadOnly is refused Settings: no link to a page that sends it back.
  const header = (
    <PageHeader
      title="Qualifications"
      count={people.length > 0 ? `${plural(issueTotal, 'issue')} across ${attention.length} of ${people.length} active staff` : undefined}
      action={canAccessPage('settings') && (
        <Button to="/settings?section=alerts" variant="secondary" size="md">
          <Settings className="w-4 h-4" /> Warning window
        </Button>
      )}
    />
  )

  if (people.length === 0) {
    return (
      <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
        {header}
        {isError || retryingAfterError(pageQuery) ? <PageState kind="error" noun="staff list" onRetry={() => refetch()} /> : <EmptyState
          icon={UserCog}
          title="No staff members yet"
          description="This page tracks expiry dates for staff certifications like First Aid, driver licences, and manual handling. Add a staff member to start tracking theirs."
          action={canWrite && !staffFromPayroll ? { label: 'New staff member', to: '/staff/new' } : undefined}
        />}
      </div>
    )
  }

  const nothingToReview = onlyAttention && listed.length === 0 && !q
  const rows: QualRow[] = current
    ? current.credentials.map(c => ({
        key: `${current.staff.id}-${c.field}`,
        staffId: current.staff.id,
        staffName: current.staff.fullName,
        qualification: c.label,
        fieldKey: c.field,
        expiryDate: c.expiryDate,
        state: c.state,
      }))
    : []
  const notHeld = CREDENTIALS.filter(c => !current?.credentials.some(h => h.key === c.key)).map(c => c.label)
  const busy = rereading || updateStaff.isPending

  // From lg the grid takes the height left and each column scrolls inside itself (AppLayout's has-[[data-fit-screen]], as Compatibility does).
  return (
    <div data-fit-screen className="flex flex-col gap-[var(--section-gap)] animate-fade-in lg:min-h-0 lg:flex-1">
      {header}

      <ToggleGroup
        ariaLabel="Show"
        value={onlyAttention ? 'attention' : 'all'}
        onChange={key => setParam('show', key === 'attention' ? 'attention' : null)}
        options={[{ key: 'all', label: `All staff (${people.length})` }, { key: 'attention', label: `Needs attention (${attention.length})` }]}
      />

      {pageError && (
        <Callout
          tone="error"
          actions={
            <Button variant="ghost" size="sm" iconOnly onClick={() => setPageError(null)} aria-label="Dismiss error">
              <X className="h-4 w-4" />
            </Button>
          }
        >
          {pageError}
        </Callout>
      )}

      {nothingToReview ? (
        <Card className="p-[var(--card-pad)] text-center">
          <span className="material-symbols-outlined text-5xl leading-none text-[var(--color-primary)] mb-3 block">check_circle</span>
          <p className="font-semibold text-[var(--color-foreground)]">All qualifications are current</p>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            No issues found within the {warningDays}-day warning window
          </p>
        </Card>
      ) : (
        <div className="md:grid md:grid-cols-[15.5rem_minmax(0,1fr)] md:items-start md:gap-6 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
          {/* Below md the list and the detail are two steps: the list until a person is chosen, then the detail. */}
          <nav aria-label="Staff" className={cn('space-y-2 md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto lg:static lg:flex lg:min-h-0 lg:max-h-none lg:flex-col lg:overflow-visible', chosen && 'max-md:hidden')}>
            <SearchInput value={query} onChange={setQuery} placeholder="Search staff" className="w-full" />
            {listed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No staff match “{query.trim()}”.</p>
            ) : (
              <ul onKeyDown={onListKeyDown} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-0.5">
                {listed.map(p => (
                  <li key={p.staff.id}>
                    <Link
                      id={`qual-staff-${p.staff.id}`}
                      to={{ search: `?${new URLSearchParams({ ...Object.fromEntries(params), staff: p.staff.id })}` }}
                      onClick={closeEditor}
                      aria-current={p === current ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 flex-col justify-center rounded-[var(--radius-sm)] px-3 py-1 hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
                        p === current && 'bg-[var(--color-accent)]',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" data-dot={p.worst} className={cn('size-2.5 shrink-0 rounded-full', DOT_CLASS[p.worst])} />
                        <span className="truncate text-sm font-medium">{p.staff.fullName}</span>
                      </span>
                      <span className="pl-[1.125rem] text-xs text-muted-foreground">
                        {p.issueCount === 0 ? 'All current' : `${WORST_WORD[p.worst]} · ${plural(p.issueCount, 'issue')}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          {current && (
            <div className={cn('min-w-0 space-y-4 lg:relative lg:min-h-0 lg:overflow-y-auto lg:p-0.5', !chosen && 'max-md:hidden')}>
              <BackButton variant="link" label="staff" onBack={() => { closeEditor(); setParam('staff', null) }} className="md:hidden" />
              <div className="flex items-center justify-between gap-3">
                <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">{current.staff.fullName}</h2>
                {canWrite && <Button variant="secondary" size="sm" to={`/staff/${current.staff.id}/edit`}>Edit staff record</Button>}
              </div>

              <DataTable<QualRow>
                data={rows}
                keyField="key"
                editingRow={editingKey}
                onEditChange={(_row, _key, value) => setEditValue(value as string)}
                compact
                className="overflow-x-auto"
                rowClassName={(r) =>
                  r.state.status === 'overdue' ? 'bg-[var(--color-error-container)]/10' :
                  r.state.status === 'today' || r.state.status === 'soon' ? 'bg-[var(--color-warning-container)]/10' : ''
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
                      render: (r, onChange) => (
                        <div className="space-y-1">
                          <input
                            type="date"
                            autoFocus
                            value={editValue}
                            onChange={e => { onChange(e.target.value); setBadInput(e.target.validity.badInput) }}
                            // No save on blur: a date picker blurs the field when its own popup opens.
                            onKeyDown={e => {
                              if (e.key === 'Escape') closeEditor()
                              else if (e.key === 'Enter' && !badInput && !busy) handleSave(r)
                            }}
                            aria-label="Expiry date"
                            className={`${inputClass} text-sm`}
                          />
                          {badInput && <p className="text-xs text-[var(--color-muted-foreground)]">Enter a full date.</p>}
                          {saveError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{saveError}</p>}
                        </div>
                      ),
                    },
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    // The compact form: this is a narrow table cell (on a phone each row is a wrapping card), and the column header already says Status.
                    render: (r) => <StatusBadge tone={DEADLINE_TONE[r.state.status]} label={deadlineLabel(r.state, 'compact')} />,
                  },
                  {
                    key: 'actions',
                    header: '',
                    align: 'right' as const,
                    render: (r) => {
                      const isEditing = editingKey === r.key
                      const isSaving = savingKey === r.key || (isEditing && rereading) // one editor is open at a time, so rereading belongs to it
                      const missing = r.state.status === 'none'
                      return isEditing ? (
                        <div className="flex items-center gap-1.5 pointer-coarse:gap-2 justify-end">
                          <Button size="sm" onClick={() => handleSave(r)} disabled={isSaving || updateStaff.isPending || badInput}>
                            {isSaving ? 'Saving…' : 'Save'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={closeEditor} disabled={savingKey === r.key}>
                            Cancel
                          </Button>
                        </div>
                      ) : canWrite ? (
                        // Every row has one, so its name says whose credential it edits.
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(r)} disabled={updateStaff.isPending} aria-label={`${missing ? 'Add date' : 'Edit'}: ${r.qualification}, ${r.staffName}`}>
                          {missing ? 'Add date' : 'Edit'}
                        </Button>
                      ) : null
                    },
                  },
                ]}
              />

              {notHeld.length > 0 && (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Not held: {notHeld.join(', ')}.
                  {canWrite && <> Change this on the <Link to={`/staff/${current.staff.id}/edit`} className="underline underline-offset-2 hover:text-[var(--color-foreground)]">staff record</Link>.</>}
                </p>
              )}

              {/* In normal flow, never fixed: the phone's bottom nav covers fixed chrome. */}
              <div className="mt-4 grid grid-cols-2 items-center gap-2 md:flex md:justify-between">
                <Button variant="secondary" size="md" className="w-full md:w-auto" disabled={!previous || busy} onClick={() => previous && step(previous)}>
                  ← Previous
                </Button>
                {index >= 0 && <span className="col-span-2 row-start-1 text-center text-sm text-[var(--color-muted-foreground)] md:col-auto md:row-auto">{index + 1} of {listed.length}</span>}
                <Button
                  variant="secondary"
                  size="md"
                  className="w-full md:w-auto"
                  disabled={!next || busy}
                  aria-label={next ? `Next: ${next.staff.fullName}` : undefined}
                  onClick={() => next && step(next)}
                >
                  {next ? `Next: ${next.staff.fullName.split(' ')[0]}` : 'Next'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
