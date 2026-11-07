import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FilePlus2, FileText, Trash2, CalendarX } from 'lucide-react'
import { useDeleteServiceAgreementDraft, useDownloadServiceAgreementDraftPdf, useEndAgreementEarly, useServiceAgreementDrafts, useStoredAgreementCheck } from '@/api/hooks'
import type { ServiceAgreementDraftDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, RowMenu, type RowMenuItem } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDayNumber, localIsoDate, parseDateOnly } from '@/lib/dateOnly'
import { formatDateRange } from '@/lib/dateRange'
import { plural } from '@/lib/format'
import { queryPhase } from '@/lib/queryPhase'
import type { Tone } from '@/lib/tone'
import { extractErrorMessage, formatCurrency } from '@/lib/utils'
import { agreementLabel, isPlainAgreement, KIND_LABEL } from '@/lib/agreementKind'
import { usePermissions } from '@/lib/permissions'
import { CombinedWarning } from '../agreement/CombinedWarning'
import { versionRows, warningTarget, type VersionRow, type VersionStatus } from './agreementVersions'

// The same tones as the Agreements page (pages/agreements/agreementRows.ts statusBadge), so both lists read alike.
const TONE: Record<VersionStatus, Tone> = {
  Draft: 'warning', Approved: 'success', Upcoming: 'neutral', Replaced: 'neutral', Ended: 'danger', 'Ended early': 'danger',
}

const day = (iso: string) => formatDateRange(iso, iso)
const dayBefore = (iso: string) => { const n = parseDateOnly(iso); return n === null ? iso : formatDayNumber(n - 1) }
const draftPage = (participantId: string) => `/participants/${participantId}/agreement-draft`

/** One agreement of the participant: its versions, newest first. */
type Group = { id: string; head: ServiceAgreementDraftDto; rows: VersionRow[] }
type Dialog = { kind: 'delete' | 'end'; row: VersionRow; group: Group }
type EndResult = Pick<ServiceAgreementDraftDto, 'agreementEndDate' | 'oldShiftsRemaining'>

export function AgreementsSection({ participantId }: { participantId: string }) {
  const query = useServiceAgreementDrafts(participantId)
  const remove = useDeleteServiceAgreementDraft()
  const endEarly = useEndAgreementEarly()
  const pdf = useDownloadServiceAgreementDraftPdf()
  const phase = queryPhase(query)
  const { canManageParticipantLifecycle: canDraft, canManageFunding } = usePermissions()
  // Grouped by agreement in the server's order (most recently changed first); each group is read as its own list, so "newest" and "replaced" are per agreement.
  const groups = useMemo<Group[]>(() => {
    const today = localIsoDate()
    const byId = new Map<string, ServiceAgreementDraftDto[]>()
    for (const d of query.data ?? []) byId.set(d.agreementId, [...(byId.get(d.agreementId) ?? []), d])
    return [...byId].map(([id, list]) => ({ id, head: list[0], rows: versionRows(list, today) }))
  }, [query.data])
  const plain = groups.length === 1 && isPlainAgreement(groups[0].head)
  // The check counts every other active agreement against the one asked about, so one request covers the page (and only a role that sees money asks).
  const target = canManageFunding ? warningTarget(groups.map(g => ({ agreementId: g.id, rows: g.rows }))) : null
  const combined = useStoredAgreementCheck(participantId, target?.draftId, target?.agreementId, !!target).data
  const selfOf = (id: string) => { const g = groups.find(x => x.id === id); const r = g?.rows.find(x => x.status === 'Approved'); return g && r ? { label: agreementLabel(g.head), version: r.version } : undefined }

  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [lastDay, setLastDay] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<React.ReactNode>(null)
  const [headingFocus, setHeadingFocus] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  // A row that is gone has no menu to return to, so focus goes to the section heading. Late, so the dialog's own focus restore has finished.
  useEffect(() => {
    if (!headingFocus) return
    const timer = setTimeout(() => {
      const heading = wrapRef.current?.querySelector('h3')
      heading?.setAttribute('tabindex', '-1')
      heading?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [headingFocus])

  const close = () => { setDialog(null); setLastDay(''); setError(null) }
  const ended = (g: Group) => g.rows[0].status === 'Ended' || g.rows[0].status === 'Ended early'
  const link = (g: Group, rest = '') => `${draftPage(participantId)}?agreement=${g.id}${rest}`
  const named = (g: Group) => (plain ? '' : ` of ${agreementLabel(g.head)}`)

  const itemsFor = (g: Group, r: VersionRow): { visible: { label: string; to?: string; onClick?: () => void }; menu: RowMenuItem[] } => {
    const download: RowMenuItem = { label: 'Download PDF', icon: <Download className="w-4 h-4" aria-hidden="true" />, onSelect: () => pdf.mutate({ participantId, id: r.id }) }
    const visiblePdf = { label: 'PDF', onClick: () => pdf.mutate({ participantId, id: r.id }) }
    if (r.status === 'Draft' && r.newest) {
      return { visible: { label: 'Edit', to: link(g) }, menu: [{ label: 'Delete draft', icon: <Trash2 className="w-4 h-4" aria-hidden="true" />, onSelect: () => setDialog({ kind: 'delete', row: r, group: g }), danger: true }] }
    }
    if (r.status !== 'Approved' && r.status !== 'Upcoming') return { visible: visiblePdf, menu: [] }
    // A newer approved revision that starts on or before this one's end owns what is left of it, so ending this one early would end nothing.
    const endItem: RowMenuItem[] = r.takesOverOn ? [] : [{ label: 'End early…', icon: <CalendarX className="w-4 h-4" aria-hidden="true" />, onSelect: () => setDialog({ kind: 'end', row: r, group: g }) }]
    if (r.newest) {
      return {
        visible: { label: 'Open', to: link(g) },
        menu: [{ label: 'New revision', icon: <FilePlus2 className="w-4 h-4" aria-hidden="true" />, to: link(g, '&revise=1') }, ...endItem, download],
      }
    }
    return { visible: visiblePdf, menu: endItem.length ? [...endItem, download] : [] }
  }

  const confirmDelete = (r: VersionRow) => {
    setError(null)
    remove.mutate({ participantId, draftId: r.id }, {
      onSuccess: () => { close(); setNotice(null); setHeadingFocus(n => n + 1) },
      onError: err => setError(extractErrorMessage(err, 'Could not delete this draft.')),
    })
  }

  const maxDay = dialog ? dayBefore(dialog.row.end) : ''
  const validDay = !!dialog && lastDay >= dialog.row.start && lastDay <= maxDay && !!lastDay

  const confirmEnd = (r: VersionRow) => {
    setError(null)
    endEarly.mutate({ participantId, draftId: r.id, lastDay }, {
      onSuccess: (result: EndResult) => {
        const left = (result.oldShiftsRemaining?.open ?? 0) + (result.oldShiftsRemaining?.assigned ?? 0)
        const removed = result.oldShiftsRemaining?.removed ?? 0
        const renewal = dialog?.group.rows.find(x => x.version > r.version && x.status === 'Upcoming' && x.start > lastDay)
        setNotice(
          <>
            Version {r.version}{named(dialog!.group)} now ends {day(result.agreementEndDate ?? lastDay)}.
            {removed > 0 && <> {plural(removed, 'unfilled draft shift')} {removed === 1 ? 'was' : 'were'} removed.</>}
            {left > 0 && <> {plural(left, 'shift')} after it {left === 1 ? 'is' : 'are'} still on the roster: cancel or move them. <Link className="font-medium underline" to={`/participants/${participantId}?tab=people#roster`}>Open roster</Link></>}
            {renewal && <> Version {renewal.version} is still approved to start on {day(renewal.start)}.</>}
          </>,
        )
        close()
      },
      onError: err => setError(extractErrorMessage(err, 'Could not end this agreement early.')),
    })
  }

  const alertLine = error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>
  const approvedRenewal = dialog?.kind === 'end' ? dialog.group.rows.find(x => x.version > dialog.row.version && x.status === 'Upcoming') : undefined

  const table = (g: Group) => (
    <DataTable
      data={g.rows}
      keyField="id"
      sortable={false}
      columns={[
        { key: 'version', header: 'Version', mobile: 'primary', render: r => `Version ${r.version}` },
        { key: 'status', header: 'Status', mobile: 'status', render: r => <StatusBadge tone={TONE[r.status]} label={r.status} /> },
        { key: 'term', header: 'Term', mobile: 'meta', render: r => <span className="md:whitespace-nowrap max-md:overflow-visible! max-md:whitespace-normal!">{r.term}{r.was && <span className="text-[var(--color-muted-foreground)]"> · was {r.was}</span>}</span> },
        { key: 'total', header: 'Total', mobile: 'meta', align: 'right', render: r => <span className="tabular-nums">{formatCurrency(r.total)}</span> },
        { key: 'approved', header: 'Approved', mobile: 'meta', render: r => r.approvedLine },
        {
          key: 'actions', header: '', overlay: true, minWidth: 208,
          render: r => {
            const { visible, menu } = itemsFor(g, r)
            return (
              // Its own positioned box, so the hover icons open into this column instead of over the Approved cell.
              <div className="relative ml-auto flex w-fit items-center">
                <Button variant="ghost" size="sm" to={visible.to} onClick={visible.onClick}>{visible.label}</Button>
                <RowMenu items={menu} name={`version ${r.version}`} />
              </div>
            )
          },
        },
      ]}
    />
  )

  const heading = (g: Group) => (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <h4 className="min-w-0 break-words text-sm font-semibold">
        {agreementLabel(g.head)}
        {g.head.agreementName?.trim() && <span className="font-normal text-[var(--color-muted-foreground)]"> · {KIND_LABEL[g.head.agreementKind]}</span>}
      </h4>
      {canDraft && ended(g) && <Button variant="ghost" size="sm" to={link(g)}>New revision</Button>}
    </div>
  )

  const addAgreement = canDraft && phase === 'ready' && groups.length > 0 ? <Button variant="secondary" size="sm" to={`${draftPage(participantId)}?agreement=new`}>Add agreement</Button> : undefined
  // One plain agreement has no block heading, so its New revision (when it has ended) sits beside Add agreement.
  const reviseOnly = canDraft && plain && ended(groups[0]) ? <Button variant="ghost" size="sm" to={link(groups[0])}>New revision</Button> : undefined

  return (
    <div ref={wrapRef}>
      <Card
        title="Agreements"
        action={addAgreement || reviseOnly ? <div className="flex flex-wrap items-center gap-2">{reviseOnly}{addAgreement}</div> : undefined}
      >
        {notice && <p role="status" className="mb-3 text-sm">{notice}</p>}
        {phase === 'loading' ? (
          <PageState kind="loading" noun="agreement list" />
        ) : phase === 'error' ? (
          <PageState kind="error" noun="agreement list" onRetry={() => query.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            size="inline"
            icon={FileText}
            title="No service agreements yet"
            description="Create one to price this participant's supports and roster them once it's approved."
            action={canDraft ? { label: 'Add agreement', to: `${draftPage(participantId)}?agreement=new` } : undefined}
          />
        ) : (
          <div className="flex flex-col gap-[var(--section-gap)]">
            {combined && target && (
              <CombinedWarning check={combined} title="Together, these agreements plan more than the money available" countedLead="Counted" self={selfOf(target.agreementId)} />
            )}
            {plain ? table(groups[0]) : groups.map(g => (
              <section key={g.id} aria-label={agreementLabel(g.head)} className="flex min-w-0 flex-col gap-2">
                {heading(g)}
                {table(g)}
              </section>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        title={`Delete draft version ${dialog?.row.version ?? ''}${dialog ? named(dialog.group) : ''}?`}
        message={dialog && (
          <>
            <p>This draft was never approved. Deleting it can&apos;t be undone.{dialog.group.rows.some(r => r.version < dialog.row.version && r.status !== 'Draft') && ` Version ${dialog.group.rows.find(r => r.version < dialog.row.version && r.status !== 'Draft')!.version} stays as it is.`}</p>
            {alertLine}
          </>
        )}
        confirmLabel="Delete draft"
        cancelLabel="Keep draft"
        variant="danger"
        focusCancel
        loading={remove.isPending}
        onConfirm={() => dialog && confirmDelete(dialog.row)}
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog?.kind === 'end'}
        title={`End version ${dialog?.row.version ?? ''}${dialog ? named(dialog.group) : ''} early?`}
        message={dialog && (
          <>
            <p>It runs from {day(dialog.row.start)} to {day(dialog.row.end)}. Choose the last day of support. After that day no more shifts are made for it, unfilled draft shifts are removed, and shifts with a worker stay on the roster for you to cancel or move. The agreement stays in the history so its claims stay traceable.</p>
            {approvedRenewal && <p>Version {approvedRenewal.version} is still approved to start on {day(approvedRenewal.start)}.</p>}
            <FormField label="Last day of support" error={lastDay && !validDay ? `Choose a day from ${day(dialog.row.start)} to ${day(maxDay)}.` : undefined}>
              <input type="date" min={dialog.row.start} max={maxDay} value={lastDay} onChange={e => { setLastDay(e.target.value); setError(null) }} />
            </FormField>
            {alertLine}
          </>
        )}
        confirmLabel="End early"
        variant="danger"
        confirmDisabled={!validDay}
        loading={endEarly.isPending}
        onConfirm={() => dialog && confirmEnd(dialog.row)}
        onCancel={close}
      />
    </div>
  )
}
