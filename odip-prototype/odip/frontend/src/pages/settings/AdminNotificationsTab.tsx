import { useMemo, useState } from 'react'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { StatusBadge } from '@/components/StatusBadge'
import {
  useAdminNotifications,
  useRetryNotification,
  useSendTestEmail,
  type AdminNotificationFilters,
} from '@/api/hooks'
import {
  NOTIFICATION_EVENT_TYPE_LABELS,
  NOTIFICATION_STATUS_COLORS,
  type NotificationOutboxDto,
  type NotificationOutboxStatus,
} from '@/api/types'
import { extractErrorMessage } from '@/lib/utils'

const STATUS_FILTER_ITEMS: { value: NotificationOutboxStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Sent', label: 'Sent' },
  { value: 'Failed', label: 'Failed' },
  { value: 'Skipped', label: 'Skipped' },
]

/**
 * Settings → Failed Sends (admin), gated by canManageNotifications in SettingsPage. An outbox
 * table with status/date filters, per-row Retry on Failed rows (409 shown inline, no confirm
 * dialog — retry is non-destructive per §6), and a "Send test email" panel.
 */
export default function AdminNotificationsTab() {
  const [statusFilter, setStatusFilter] = useState<NotificationOutboxStatus | ''>('Failed')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')

  const filters: AdminNotificationFilters = useMemo(() => ({
    status: statusFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  }), [statusFilter, fromFilter, toFilter])

  const { data: rows = [], isLoading, isError, refetch } = useAdminNotifications(filters)
  const retry = useRetryNotification()
  const sendTestEmail = useSendTestEmail()

  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)

  const [testEmailTo, setTestEmailTo] = useState('')
  const [testEmailResult, setTestEmailResult] = useState<{ sent: boolean; error?: string } | null>(null)
  const [testEmailError, setTestEmailError] = useState<string | null>(null)

  async function handleRetry(row: NotificationOutboxDto) {
    setRetryingId(row.id)
    setRetryError(null)
    try {
      await retry.mutateAsync(row.id)
    } catch (err) {
      setRetryError(extractErrorMessage(err, 'Could not retry this notification. Please try again.'))
    } finally {
      setRetryingId(null)
    }
  }

  async function handleSendTestEmail() {
    setTestEmailError(null)
    setTestEmailResult(null)
    try {
      const result = await sendTestEmail.mutateAsync(testEmailTo)
      setTestEmailResult(result)
    } catch (err) {
      setTestEmailError(extractErrorMessage(err, 'Could not send the test email. Please try again.'))
    }
  }

  const columns: Column<NotificationOutboxDto>[] = [
    { key: 'eventType', header: 'Event', render: row => NOTIFICATION_EVENT_TYPE_LABELS[row.eventType] ?? row.eventType },
    { key: 'recipientName', header: 'Recipient', render: row => row.recipientName ?? row.recipientUserId },
    { key: 'status', header: 'Status', render: row => <StatusBadge status={row.status} colorMap={NOTIFICATION_STATUS_COLORS} /> },
    { key: 'attempts', header: 'Attempts', align: 'right' as const },
    { key: 'lastError', header: 'Last Error', render: row => row.lastError ?? '—' },
    { key: 'createdAt', header: 'Created', type: 'date' as const },
    {
      key: 'actions', header: '', align: 'right' as const, render: row => (
        row.status === 'Failed' ? (
          <button
            type="button"
            onClick={() => handleRetry(row)}
            disabled={retryingId === row.id}
            className="min-h-[36px] px-3 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] disabled:opacity-50"
          >
            {retryingId === row.id ? 'Retrying...' : 'Retry'}
          </button>
        ) : null
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Notification Outbox</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Every raised notification and its delivery status.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Dropdown
              variant="form"
              value={statusFilter}
              onChange={v => setStatusFilter(v as NotificationOutboxStatus | '')}
              items={STATUS_FILTER_ITEMS}
              label="Status"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="admin-notifications-from-date" className="text-xs text-[var(--color-muted-foreground)]">From</label>
            <input id="admin-notifications-from-date" type="date" value={fromFilter} onChange={e => setFromFilter(e.target.value)} />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="admin-notifications-to-date" className="text-xs text-[var(--color-muted-foreground)]">To</label>
            <input id="admin-notifications-to-date" type="date" value={toFilter} onChange={e => setToFilter(e.target.value)} />
          </div>
        </div>

        {retryError && (
          <p role="alert" className="text-xs text-[var(--color-destructive)]">{retryError}</p>
        )}

        {isLoading ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Loading...</p>
        ) : isError ? (
          <div className="text-sm text-[var(--color-muted-foreground)]">
            Couldn't load notifications.{' '}
            <button type="button" onClick={() => refetch()} className="underline">Try again</button>
          </div>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            keyField="id"
            emptyMessage="No notifications match these filters."
          />
        )}
      </div>

      <div className="max-w-md space-y-3 border-t border-[var(--color-border)] pt-6">
        <div>
          <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Send Test Email</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Bypasses the outbox — proves the SMTP configuration works right now.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={testEmailTo}
            onChange={e => setTestEmailTo(e.target.value)}
            placeholder="name@example.com"
            aria-label="Test email address"
            className="flex-1 px-3 py-2 rounded-2xl bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
          />
          <button
            type="button"
            onClick={handleSendTestEmail}
            disabled={!testEmailTo.trim() || sendTestEmail.isPending}
            className="px-4 py-2 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-all disabled:opacity-50"
          >
            {sendTestEmail.isPending ? 'Sending...' : 'Send test email'}
          </button>
        </div>
        {testEmailError && (
          <p role="alert" className="text-xs text-[var(--color-destructive)]">{testEmailError}</p>
        )}
        {testEmailResult && (
          <p className={`text-sm ${testEmailResult.sent ? 'text-[var(--color-primary)]' : 'text-[var(--color-destructive)]'}`}>
            {testEmailResult.sent ? 'Sent successfully.' : `Failed: ${testEmailResult.error ?? 'Unknown error'}`}
          </p>
        )}
      </div>
    </div>
  )
}
