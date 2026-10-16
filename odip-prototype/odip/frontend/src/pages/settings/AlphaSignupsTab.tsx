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
import { ORGANISATION_SIZE_LABELS, type EarlyAccessSignupDto } from '@/api/types'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { extractErrorMessage } from '@/lib/utils'
import { formatInstantDateAu } from '@/lib/format'

const muted = 'text-[var(--color-muted-foreground)]'
// On a phone the detail labels match the card's own field labels (index.css .mobile-card-table td::before).
const detailLabel = `text-xs ${muted} max-md:font-semibold max-md:uppercase max-md:tracking-[0.05em]`
const detailId = (row: EarlyAccessSignupDto) => `alpha-signup-${row.id}-detail`

/**
 * Settings › Platform › Alpha sign-ups (SuperAdmin): who asked to join the alpha on the landing page, latest sent first (the server's
 * order, so a repeat carrying a "remove my details" request is on top), with Delete. Six columns from md up, so the table never scrolls
 * sideways; role, phone and the message open under the row from its name (a row disclosure), and a phone card shows them all. The
 * message is shown whole, line breaks kept, because removal requests arrive in it.
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
          aria-label={row.message ? `${row.name}, has a message` : undefined}
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
          {row.message && <MessageSquareText className={`h-3.5 w-3.5 flex-shrink-0 ${muted}`} aria-hidden="true" />}
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
