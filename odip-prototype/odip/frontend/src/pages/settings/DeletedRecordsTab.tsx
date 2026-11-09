import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { Button } from '@/components/Button'
import { FieldDiff } from '@/components/AuditHistoryTab'
import { DELETED_RECORDS_PAGE_SIZE, useDeletedRecords, type DeletedRecord } from '@/api/hooks'
import { formatDateTimeAu } from '@/lib/format'
import { retryingAfterError } from '@/lib/queryPhase'
import { recordLabel, typeName, TYPE_FILTER_ITEMS } from './deletedRecordLabels'

type Row = DeletedRecord & { label: string }

const detailId = (row: Row) => `deleted-detail-${row.id}`

/** The held values of a deleted record, as the history tabs show a Deleted entry, and a way back to its participant when it had one. */
function Detail({ row }: { row: Row }) {
  const participantId = row.fields.find(f => f.field === 'ParticipantId')?.old
  return (
    <div id={detailId(row)} className="min-w-0 [overflow-wrap:anywhere] py-2">
      <div className="flex flex-col gap-0.5 pl-3 border-l-2 border-[var(--color-border)]">
        <p className="text-xs font-semibold text-[var(--color-muted-foreground)]">What it held</p>
        {row.fields.length > 0
          ? row.fields.map((f, i) => <FieldDiff key={i} {...f} />)
          : <p className="text-xs text-[var(--color-muted-foreground)]">No details were kept for this record.</p>}
        {participantId && (
          <Link className="mt-1 flex w-fit items-center text-xs underline pointer-coarse:min-h-[var(--tap-min)]" to={`/participants/${participantId}`}>Open participant</Link>
        )}
      </div>
    </div>
  )
}

/** Settings → Deleted records (Admin): what was deleted in this organisation, newest first, who deleted it, when, and what it held. */
export default function DeletedRecordsTab() {
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const query = useDeletedRecords(type, page)
  const { data, isLoading, isError, refetch } = query

  const rows: Row[] = useMemo(() => (data?.items ?? []).map(r => ({ ...r, label: recordLabel(r.entityType, r.fields) })), [data])

  const columns: Column<Row>[] = [
    // One line at 1280 (ellipsis, full label in the tooltip and the detail); it wraps in the phone card.
    { key: 'label', header: 'Record', maxWidth: '12rem', mobile: 'primary' },
    { key: 'entityType', header: 'Type', mobile: 'meta', render: r => typeName(r.entityType) },
    { key: 'deletedByName', header: 'Deleted by', maxWidth: '12rem', mobile: 'meta', render: r => r.deletedByName ?? 'System' },
    {
      key: 'deletedAt', header: 'Deleted', align: 'right', mobile: 'meta',
      render: r => <span className="tabular-nums" title={formatDateTimeAu(r.deletedAt)}>{formatDateTimeAu(r.deletedAt)}</span>,
    },
    {
      key: 'actions', header: '', srHeader: 'Details', align: 'right',
      render: r => {
        const open = openId === r.id
        return (
          <Button
            variant="ghost" size="sm" className="min-h-[var(--tap-min)]"
            aria-label={`${open ? 'Hide' : 'Show'} details for ${r.label}`}
            aria-expanded={open}
            aria-controls={open ? detailId(r) : undefined}
            onClick={() => setOpenId(open ? null : r.id)}
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            {open ? 'Hide details' : 'Show details'}
          </Button>
        )
      },
    },
  ]

  return (
    <div className="space-y-3">
      <div className="w-48">
        <Dropdown variant="form" label="Type" value={type} items={TYPE_FILTER_ITEMS} onChange={v => { setType(v); setPage(1); setOpenId(null) }} />
      </div>
      <DataTable
        data={rows}
        columns={columns}
        keyField="id"
        loading={isLoading}
        error={isError || retryingAfterError(query)}
        onRetry={() => refetch()}
        emptyMessage={type ? 'Nothing of this type has been deleted.' : 'Nothing has been deleted since this list was added.'}
        rowDetail={r => (openId === r.id ? <Detail row={r} /> : null)}
        pagination={{ page, pageSize: DELETED_RECORDS_PAGE_SIZE, totalCount: data?.totalCount ?? 0, onPageChange: p => { setPage(p); setOpenId(null) } }}
      />
    </div>
  )
}
