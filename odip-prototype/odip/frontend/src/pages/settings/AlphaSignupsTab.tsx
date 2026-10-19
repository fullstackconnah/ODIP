import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, MessageSquareText, Trash2 } from 'lucide-react'
import { DataTable, RowActions, type Column } from '@/components/DataTable'
import { ROW_ACTIONS_CARD } from '@/components/tapArea'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NoticesRegion } from '@/components/NoticesRegion'
import { StatusBadge } from '@/components/StatusBadge'
import { useNotices } from '@/hooks/useNotices'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { EARLY_ACCESS_PAGE_SIZE, useDeleteEarlyAccessSignup, useEarlyAccessSignups, useMarkEarlyAccessFollowedUp } from '@/api/hooks'
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
// and when the newest came, or a reader would take this one for the latest. Once a person has followed up, the date they did says so.
const overLimitNote = (row: EarlyAccessSignupDto) => {
  const more = `${row.overLimitCount} more sent after the first ${LATER_SUBMISSIONS_KEPT} were kept.`
  const followedUp = row.followUpClearedAtUtc ? ` Followed up ${formatInstantDateAu(row.followUpClearedAtUtc)}.` : ''
  if (row.overLimitCount === 1) return `${more} Showing it.${followedUp}`
  return `${more} Showing the first of them${row.lastOverLimitAtUtc ? `; the latest arrived ${formatInstantDateAu(row.lastOverLimitAtUtc)}` : ''}.${followedUp}`
}

// While a person has not followed up: only the first over-limit repeat is shown, so a later one (a removal request) may be unseen.
const followUpMessage = (row: EarlyAccessSignupDto) => {
  if (row.overLimitCount === 1) {
    return `Follow up: 1 more was sent after the first ${LATER_SUBMISSIONS_KEPT} were kept. It is the one shown; contact this person to check what they asked for.`
  }
  const latest = row.lastOverLimitAtUtc ? `, the latest on ${formatInstantDateAu(row.lastOverLimitAtUtc)}` : ''
  return `Follow up: ${row.overLimitCount} more sent after the first ${LATER_SUBMISSIONS_KEPT} were kept${latest}. Only the first of them is shown; contact this person to check what they asked for.`
}

const nameLabel = (row: EarlyAccessSignupDto) =>
  [row.name, hasMessage(row) && 'has a message', row.followUpNeeded && 'follow-up needed'].filter(Boolean).join(', ')

// This is the newest retained message we can show, not a claim about the newest request received.
const latestRetainedMessage = (row: EarlyAccessSignupDto) =>
  [row, ...row.laterSubmissions, ...(row.firstOverLimit ? [row.firstOverLimit] : [])]
    .reverse()
    .find(entry => !!entry.message)

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
function laterEntry(row: EarlyAccessSignupDto, later: EarlyAccessLaterSubmissionDto, note?: ReactNode, forceMessage = false) {
  return (
    <li key={later.id} className="border-t border-[var(--color-border)] pt-2">
      <p className={dateLine}>Sent {formatInstantDateAu(later.receivedAtUtc)}</p>
      {note}
      <dl className="mt-1 grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-x-10">
        {LATER_FIELDS.filter(({ key }) => later[key] !== row[key] || (forceMessage && key === 'message')).map(({ key, label }) => (
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
  const markFollowedUp = useMarkEarlyAccessFollowedUp()
  const { notices, notify, dismiss } = useNotices()
  const [marking, setMarking] = useState<string | null>(null)
  const [pending, setPending] = useState<EarlyAccessSignupDto | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const isBelowMd = useIsBelowMd()
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [historyOpen, setHistoryOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) => setOpen(current => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const toggleHistory = (id: string) => setHistoryOpen(current => {
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

  // Sends the over-limit count on screen: the server refuses (409) if more arrived since, so a repeat nobody read is never marked as handled.
  async function confirmFollowedUp(row: EarlyAccessSignupDto) {
    setMarking(row.id)
    try {
      await markFollowedUp.mutateAsync({ id: row.id, overLimitCount: row.overLimitCount })
      notify('success', row.name, 'Marked as followed up.', row.id)
    } catch (err) {
      notify('danger', row.name, apiErrorStatus(err) === 409
        ? 'A new submission arrived after you opened this. Reload to see it.'
        : `Couldn't mark this followed up. ${extractErrorMessage(err, 'Check your connection and try again.')}`, row.id)
    } finally {
      setMarking(null)
    }
  }

  // The one loud thing in the entry. It does not announce itself: many cards render at once, and an opened row is the person's own action.
  const followUpCallout = (row: EarlyAccessSignupDto) => (
    <Callout
      tone="warning"
      announce={false}
      className="mt-1"
      actions={
        <Button variant="secondary" size="sm" aria-label={`Mark followed up for ${row.name}`} disabled={marking === row.id} onClick={() => confirmFollowedUp(row)}>
          Mark followed up
        </Button>
      }
    >
      {followUpMessage(row)}
    </Callout>
  )

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
          aria-label={hasMessage(row) || row.followUpNeeded ? nameLabel(row) : undefined}
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
          {/* A closed row says it needs a follow-up without being opened: later over-limit repeats are not shown, only counted. */}
          {row.followUpNeeded && <span className="mt-0.5 block"><StatusBadge tone="warning" label="Follow up needed" /></span>}
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
  const rowDetail = (row: EarlyAccessSignupDto) => {
    const retainedRequest = latestRetainedMessage(row)
    const originalSubmission: EarlyAccessLaterSubmissionDto = { id: `${row.id}-original`, receivedAtUtc: row.createdAtUtc, name: row.name, organisation: row.organisation, role: row.role, phone: row.phone, organisationSize: row.organisationSize, message: row.message }
    const historyEntries = isBelowMd && retainedRequest && retainedRequest !== row
      ? [...(row.message && retainedRequest.message !== row.message ? [originalSubmission] : []), ...row.laterSubmissions]
      : row.laterSubmissions
    const hasHistory = historyEntries.length > 0 || (!isBelowMd && !!row.firstOverLimit) || (isBelowMd && !!row.firstOverLimit && retainedRequest !== row.firstOverLimit)
    return (isBelowMd || open.has(row.id)) ? (
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
        <dt className={detailLabel}>{isBelowMd ? 'Latest retained request' : 'Message'}</dt>
        <dd>{(isBelowMd ? retainedRequest?.message : row.message) ? <p className="max-w-[65ch] whitespace-pre-wrap break-words">{isBelowMd ? retainedRequest?.message : row.message}</p> : '—'}</dd>
      </div>
    </dl>
    {isBelowMd && row.followUpNeeded && row.firstOverLimit && followUpCallout(row)}
    {isBelowMd && row.firstOverLimit && !row.followUpNeeded && <p className={`mt-2 text-xs ${muted}`}>{overLimitNote(row)}</p>}
    {hasHistory && isBelowMd && (
      <button
        type="button"
        aria-expanded={historyOpen.has(row.id)}
        aria-controls={`${detailId(row)}-history`}
        onClick={() => toggleHistory(row.id)}
        className="mt-3 min-h-11 text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
      >
        {historyOpen.has(row.id) ? 'Hide older submissions' : 'Show older submissions'}
      </button>
    )}
    {hasHistory && (!isBelowMd || historyOpen.has(row.id)) && (
      <section id={`${detailId(row)}-history`} aria-label="Later submissions" className="mt-3 md:pl-[1.125rem]">
        <h4 className={detailLabel}>Later submissions</h4>
        {/* The server keeps the first 10. RequestCount also counts identical repeats, so say this only once the 10 are full. */}
        {!row.firstOverLimit && row.laterSubmissions.length >= LATER_SUBMISSIONS_KEPT && row.requestCount - 1 > LATER_SUBMISSIONS_KEPT && (
          <p className={`mt-1 text-xs ${muted}`}>
            Only the first {LATER_SUBMISSIONS_KEPT} later submissions are kept. The form was sent {row.requestCount} times in all.
          </p>
        )}
        <ol className="mt-1 space-y-2">
          {historyEntries.map(later => laterEntry(row, later, undefined, later.id === originalSubmission.id))}
          {row.firstOverLimit && laterEntry(row, row.firstOverLimit,
            !isBelowMd && row.followUpNeeded ? followUpCallout(row) : <p className={`text-xs ${muted}`}>{overLimitNote(row)}</p>)}
        </ol>
      </section>
    )}
    {isBelowMd && <div className={`mt-2 flex justify-end ${ROW_ACTIONS_CARD}`}>{deleteButton(row)}</div>}
    </>
    ) : null
  }

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
