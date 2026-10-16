import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { DataTable, RowActions, type Column } from '@/components/DataTable'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NoticesRegion } from '@/components/NoticesRegion'
import { useNotices } from '@/hooks/useNotices'
import { EARLY_ACCESS_PAGE_SIZE, useDeleteEarlyAccessSignup, useEarlyAccessSignups } from '@/api/hooks'
import { ORGANISATION_SIZE_LABELS, type EarlyAccessSignupDto } from '@/api/types'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { extractErrorMessage } from '@/lib/utils'
import { formatInstantDateAu } from '@/lib/format'

const muted = 'text-[var(--color-muted-foreground)]'

/**
 * Settings › Platform › Alpha sign-ups (SuperAdmin): who asked to join the alpha on the landing page, latest sent first (the server's
 * order, so a repeat carrying a "remove my details" request is on top), with Delete. The message is shown whole, line breaks kept,
 * because removal requests arrive in it.
 */
export default function AlphaSignupsTab() {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, refetch } = useEarlyAccessSignups(page)
  const remove = useDeleteEarlyAccessSignup()
  const { notices, notify, dismiss } = useNotices()
  const [pending, setPending] = useState<EarlyAccessSignupDto | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // The deleted row and its trigger are gone, so focus goes to the notice saying so rather than falling to <body>.
  const noticesRef = useRef<HTMLDivElement>(null)
  const seen = useRef(0)
  useEffect(() => {
    if (notices.length > seen.current) noticesRef.current?.focus()
    seen.current = notices.length
  }, [notices.length])

  // Deleting the only row of the last page must not leave an empty page while sign-ups remain.
  useEffect(() => {
    if (data && data.items.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])

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

  const columns: Column<EarlyAccessSignupDto>[] = [
    { key: 'name', header: 'Name', mobile: 'primary' },
    { key: 'organisation', header: 'Organisation', maxWidth: '12rem', mobile: 'meta' },
    {
      key: 'organisationSize', header: 'Size', mobile: 'meta',
      render: row => row.organisationSize
        ? ORGANISATION_SIZE_LABELS[row.organisationSize] ?? row.organisationSize
        : <span className={muted}>Not given</span>,
    },
    { key: 'role', header: 'Role', render: row => row.role ?? '—' },
    { key: 'email', header: 'Email' },
    { key: 'phone', header: 'Phone', render: row => row.phone ?? '—' },
    {
      // Whole and wrapped, never cut to a tooltip: a removal request is read here.
      key: 'message', header: 'Message', wrap: true, minWidth: '16rem',
      render: row => row.message
        ? <p className="max-w-[28rem] whitespace-pre-wrap break-words">{row.message}</p>
        : '—',
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
      key: 'actions', header: '', align: 'right' as const,
      render: row => (
        <RowActions>
          <Button
            variant="ghost"
            iconOnly
            aria-label={`Delete sign-up from ${row.name}`}
            title="Delete sign-up"
            onClick={() => { setDeleteError(null); setPending(row) }}
          >
            <Trash2 className="w-4 h-4" aria-hidden />
          </Button>
        </RowActions>
      ),
    },
  ]

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
