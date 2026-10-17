import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, MessageSquareText, Trash2 } from 'lucide-react'
import { DataTable, RowActions, type Column } from '@/components/DataTable'
import { ROW_ACTIONS_CARD } from '@/components/tapArea'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NoticesRegion } from '@/components/NoticesRegion'
import { useNotices } from '@/hooks/useNotices'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { EARLY_ACCESS_PAGE_SIZE, useDeleteEarlyAccessSignup, useEarlyAccessSignups } from '@/api/hooks'
import { ORGANISATION_SIZE_LABELS, type EarlyAccessLaterSubmissionDto, type EarlyAccessSignupDto } from '@/api/types'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { extractErrorMessage } from '@/lib/utils'
import { formatInstantDateAu } from '@/lib/format'

const muted = 'text-[var(--color-muted-foreground)]'
// On a phone the detail labels match the card's own field labels (index.css .mobile-card-table td::before).
const detailLabel = `text-xs ${muted} max-md:font-semibold max-md:uppercase max-md:tracking-[0.05em]`
const detailId = (row: EarlyAccessSignupDto) => `alpha-signup-${row.id}-detail`
// A date line heads its block, so it is full strength where the labels under it are muted.
const dateLine = 'text-xs font-medium text-[var(--color-foreground)]'
// Removal requests arrive in a message, which may be in a later submission rather than the original.
const hasMessage = (row: EarlyAccessSignupDto) =>
  !!row.message || row.laterSubmissions.some(l => !!l.message) || !!row.firstOverLimit?.message

// What the entry after the first 10 is: the first of the further repeats, which later ones never replace. They are only counted, so say so
// and when the newest came, or a reader would take this one for the latest.
const overLimitNote = (row: EarlyAccessSignupDto) => {
  const more = `${row.overLimitCount} more sent after the first ${LATER_SUBMISSIONS_KEPT} were kept.`
  if (row.overLimitCount === 1) return `${more} Showing it.`
  return `${more} Showing the first of them${row.lastOverLimitAtUtc ? `; the latest arrived ${formatInstantDateAu(row.lastOverLimitAtUtc)}` : ''}.`
}

// The answers a repeat can change, in the order the original row shows them after Name and Organisation. The API keeps the first 10 per sign-up.
const LATER_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'organisation', label: 'Organisation' },
  { key: 'role', label: 'Role' },
  { key: 'phone', label: 'Phone' },
  { key: 'organisationSize', label: 'Size' },
  { key: 'message', label: 'Message' },
] as const
const LATER_SUBMISSIONS_KEPT = 10
const displayAnswer = (key: (typeof LATER_FIELDS)[number]['key'], value: string | undefined) =>
  key === 'organisationSize' && value ? ORGANISATION_SIZE_LABELS[value] ?? value : value

// One later entry: a date headline, an optional muted note, then only the answers that differ from the stored ones. The same two tracks as the original answers,
// so Phone lines up with theirs whichever fields are listed.
function laterEntry(row: EarlyAccessSignupDto, later: EarlyAccessLaterSubmissionDto, note?: string) {
  return (
    <li key={later.id} className="border-t border-[var(--color-border)] pt-2">
      <p className={dateLine}>Sent {formatInstantDateAu(later.receivedAtUtc)}</p>
      {note && <p className={`text-xs ${muted}`}>{note}</p>}
      <dl className="mt-1 grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-x-10">
        {LATER_FIELDS.filter(({ key }) => later[key] !== row[key]).map(({ key, label }) => (
          <div key={key} className={key === 'message' ? 'col-span-2 min-w-0' : `min-w-0 break-words${key === 'phone' ? ' col-start-2' : ''}`}>
            <dt className={detailLabel}>{label}</dt>
            <dd>
              {!later[key] ? '—' : key === 'message'
                ? <p className="max-w-[65ch] whitespace-pre-wrap break-words">{later[key]}</p>
                : displayAnswer(key, later[key])}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  )
}

/**
 * Settings › Platform › Alpha sign-ups (SuperAdmin): who asked to join the alpha on the landing page, latest sent first (the server's
 * order, so a repeat carrying a "remove my details" request is on top), with Delete. Six columns from md up, so the table never scrolls
 * sideways; role, phone and the message open under the row from its name (a row disclosure), and a phone card shows them all. The
 * message is shown whole, line breaks kept, because removal requests arrive in it.
 * A repeat sign-up never overwrites the stored answers; one whose answers differ is listed under the opened row as a later submission, with its date
 * and only the answers that differ (the server keeps the first 10, then the first of any sent after them, with how many there were and when the latest came).
 */
export default function AlphaSignupsTab() {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, refetch } = useEarlyAccessSignups(page)
  const remove = useDeleteEarlyAccessSignup()
  const { notices, notify, dismiss } = useNotices()
  const [pending, setPending] = useState<EarlyAccessSignupDto | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const isBelowMd = useIsBelowMd()
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) => setOpen(current => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })

  // The deleted row and its trigger are gone, so focus goes to the notice saying so rather than falling to <body>.
  const noticesRef = useRef<HTMLDivElement>(null)
  const seen = useRef(0)
  useEffect(() => {
    if (notices.length > seen.current) noticesRef.current?.focus()
    seen.current = notices.length
  }, [notices.length])

  // Deleting the only row of the last page must not leave an empty page while sign-ups remain. Set during render (React's
  // derived-state pattern), not in an effect.
  if (data && data.items.length === 0 && page > 1) setPage(page - 1)

  async function confirmDelete() {
    if (!pending) return
    setDeleteError(null)
    try {
      await remove.mutateAsync(pending.id)
    } catch (err) {
      // 404: the purge or another tab got there first; the row is gone either way, which is what was asked.
      if (apiErrorStatus(err) !== 404) {
        setDeleteError(`Couldn't delete this sign-up. ${extractErrorMessage(err, 'Check your connection and try again.')}`)
        return
      }
    }
    notify('success', pending.name, 'Sign-up deleted.', pending.id)
    setPending(null)
  }

  const deleteButton = (row: EarlyAccessSignupDto) => (
    <Button
      variant="ghost"
      iconOnly
      aria-label={`Delete sign-up from ${row.name}`}
      title="Delete sign-up"
      onClick={() => { setDeleteError(null); setPending(row) }}
    >
      <Trash2 className="w-4 h-4" aria-hidden />
    </Button>
  )

  const columns: Column<EarlyAccessSignupDto>[] = [
    {
      key: 'name', header: 'Name', mobile: 'primary',
      // From md up the name opens the row's details (the SchedulePage staff-row disclosure); a phone card already shows them.
      render: row => isBelowMd ? row.name : (
        <button
          type="button"
          aria-label={hasMessage(row) ? `${row.name}, has a message` : undefined}
          aria-expanded={open.has(row.id)}
          aria-controls={open.has(row.id) ? detailId(row) : undefined}
          onClick={() => toggle(row.id)}
          className="inline-flex max-w-[14rem] items-center gap-1 rounded-[var(--radius-sm)] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          {open.has(row.id)
            ? <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 ${muted}`} aria-hidden="true" />
            : <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 ${muted}`} aria-hidden="true" />}
          <span className="truncate">{row.name}</span>
          {/* Removal requests arrive in the message, so a closed row says it has one (the text stays in the detail). */}
          {hasMessage(row) && <MessageSquareText className={`h-3.5 w-3.5 flex-shrink-0 ${muted}`} aria-hidden="true" />}
        </button>
      ),
    },
    { key: 'organisation', header: 'Organisation', maxWidth: '12rem', mobile: 'meta' },
    { key: 'email', header: 'Email', maxWidth: '16rem' },
    {
      key: 'organisationSize', header: 'Size', mobile: 'meta',
      render: row => row.organisationSize
        ? ORGANISATION_SIZE_LABELS[row.organisationSize] ?? row.organisationSize
        : <span className={muted}>Not given</span>,
    },
    {
      key: 'lastRequestedAtUtc', header: 'Last sent',
      render: row => (
        <span title={`First sent ${formatInstantDateAu(row.createdAtUtc)}`}>
          {formatInstantDateAu(row.lastRequestedAtUtc)}
          {row.requestCount > 1 && <span className={`block text-xs ${muted}`}>Sent {row.requestCount} times</span>}
        </span>
      ),
    },
    {
      // On a phone Delete sits at the foot of the card instead (rowDetail), so it has one place and never splits the details.
      key: 'actions', header: '', align: 'right' as const, mobile: 'hidden',
      render: row => isBelowMd ? null : <RowActions>{deleteButton(row)}</RowActions>,
    },
  ]

  // Role and phone as a pair, then the whole message: under the row once its name is opened, and always on a phone card, which
  // ends with Delete. A stack at the name's indent, so it never looks like columns of the table above.
  const rowDetail = (row: EarlyAccessSignupDto) => (isBelowMd || open.has(row.id)) ? (
    <>
    {(row.laterSubmissions.length > 0 || row.firstOverLimit) && <p className={`mb-1 md:pl-[1.125rem] ${dateLine}`}>First sent {formatInstantDateAu(row.createdAtUtc)}</p>}
    <dl id={detailId(row)} className="grid grid-cols-2 gap-x-8 gap-y-2 md:flex md:flex-wrap md:gap-x-10 md:pl-[1.125rem]">
      {/* A fixed width from md up, so Phone starts at the same x in every opened row. */}
      <div className="min-w-0 break-words md:w-48">
        <dt className={detailLabel}>Role</dt>
        <dd>{row.role ?? '—'}</dd>
      </div>
      <div>
        <dt className={detailLabel}>Phone</dt>
        <dd>{row.phone ?? '—'}</dd>
      </div>
      <div className="col-span-2 min-w-0 md:basis-full">
        <dt className={detailLabel}>Message</dt>
        <dd>{row.message ? <p className="max-w-[65ch] whitespace-pre-wrap break-words">{row.message}</p> : '—'}</dd>
      </div>
    </dl>
    {(row.laterSubmissions.length > 0 || row.firstOverLimit) && (
      <section aria-label="Later submissions" className="mt-3 md:pl-[1.125rem]">
        <h4 className={detailLabel}>Later submissions</h4>
        {/* The server keeps the first 10. RequestCount also counts identical repeats, so say this only once the 10 are full. */}
        {!row.firstOverLimit && row.laterSubmissions.length >= LATER_SUBMISSIONS_KEPT && row.requestCount - 1 > LATER_SUBMISSIONS_KEPT && (
          <p className={`mt-1 text-xs ${muted}`}>
            Only the first {LATER_SUBMISSIONS_KEPT} later submissions are kept. The form was sent {row.requestCount} times in all.
          </p>
        )}
        <ol className="mt-1 space-y-2">
          {row.laterSubmissions.map(later => laterEntry(row, later))}
          {row.firstOverLimit && laterEntry(row, row.firstOverLimit, overLimitNote(row))}
        </ol>
      </section>
    )}
    {isBelowMd && <div className={`mt-2 flex justify-end ${ROW_ACTIONS_CARD}`}>{deleteButton(row)}</div>}
    </>
  ) : null

  return (
    <div>
      <div ref={noticesRef} tabIndex={-1} className={`outline-none ${notices.length > 0 ? 'mb-3' : ''}`}>
        <NoticesRegion notices={notices} onDismiss={dismiss} />
      </div>

      <DataTable
        data={data?.items ?? []}
        columns={columns}
        keyField="id"
        sortable={false}
        loading={isLoading}
        error={isError}
        onRetry={() => refetch()}
        emptyMessage="No one has signed up for the alpha yet."
        rowDetail={rowDetail}
        pagination={{ page, pageSize: EARLY_ACCESS_PAGE_SIZE, totalCount: data?.totalCount ?? 0, onPageChange: setPage }}
      />

      <ConfirmDialog
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={confirmDelete}
        title="Delete this sign-up?"
        message={pending && (
          <>
            <p>{pending.name}, {pending.organisation} ({pending.email}).</p>
            <p>Their details are deleted for good. A record that a sign-up was deleted, and by whom, is kept.</p>
            {deleteError && <p role="alert" className="text-[var(--color-destructive)]">{deleteError}</p>}
          </>
        )}
        confirmLabel="Delete sign-up"
        variant="danger"
        loading={remove.isPending}
      />
    </div>
  )
}
