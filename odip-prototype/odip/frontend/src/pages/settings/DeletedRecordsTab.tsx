import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { CellText, DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { Button } from '@/components/Button'
import AuditHistoryTab, { FieldDiff } from '@/components/AuditHistoryTab'
import { DELETED_RECORDS_PAGE_SIZE, useDeletedRecords, useProviderSettings, type DeletedRecord } from '@/api/hooks'
import { formatDateTimeAu } from '@/lib/format'
import { retryingAfterError } from '@/lib/queryPhase'
import { fieldLabel, recordLabel, typeName, TYPE_FILTER_ITEMS } from './deletedRecordLabels'

type Row = DeletedRecord & { label: string }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const detailId = (row: Row) => `deleted-detail-${row.id}`

// The types whose audit history the server still serves once the record is gone (AuditController's deleted-record fallback).
const FULL_HISTORY_TYPES = ['Shift', 'ShiftPattern']

/** The held values of a deleted record, as the history tabs show a Deleted entry, and a way back to its participant when it had one. */
function Detail({ row }: { row: Row }) {
  const [history, setHistory] = useState(false)
  const participantId = row.fields.find(f => f.field === 'ParticipantId')?.old
  // A bare id tells the reader nothing; the participant has its own link below.
  const shown = row.fields.filter(f => !(f.field?.endsWith('Id') && GUID.test(f.old ?? '')))
  return (
    <div id={detailId(row)} className="min-w-0 [overflow-wrap:anywhere] py-2">
      <div className="flex flex-col gap-0.5 pl-3 border-l-2 border-[var(--color-border)]">
        <p className="text-xs font-semibold text-[var(--color-muted-foreground)]">What it held</p>
        {shown.length > 0
          ? shown.map((f, i) => <FieldDiff key={i} {...f} field={fieldLabel(f.field ?? '')} />)
          : <p className="text-xs text-[var(--color-muted-foreground)]">No details were kept for this record.</p>}
        {participantId && (
          <Link className="mt-1 flex w-fit items-center text-xs underline pointer-coarse:min-h-[var(--tap-min)]" to={`/participants/${participantId}`}>Open participant</Link>
        )}
        {FULL_HISTORY_TYPES.includes(row.entityType) && (
          <Button
            variant="ghost" size="sm" className="mt-1 w-fit min-h-[var(--tap-min)]"
            aria-expanded={history}
            aria-controls={history ? `${detailId(row)}-history` : undefined}
            onClick={() => setHistory(h => !h)}
          >
            {history ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            {history ? 'Hide full history' : 'Show full history'}
          </Button>
        )}
        {history && <div id={`${detailId(row)}-history`} className="pt-2"><AuditHistoryTab entityType={row.entityType} entityId={row.entityId} /></div>}
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
  // The provider's zone, so a deleted time reads as the provider's day; none yet (or none saved) keeps the viewer's.
  const zone = useProviderSettings().data?.timeZoneId

  const rows: Row[] = useMemo(() => (data?.items ?? []).map(r => ({ ...r, label: recordLabel(r.entityType, r.fields, zone) })), [data, zone])

  const columns: Column<Row>[] = [
    // Two lines at 1280 (then an ellipsis, full label in the tooltip and the detail); it wraps whole in the phone card.
    { key: 'label', header: 'Record', mobile: 'primary', render: r => <CellText lines={2} className="md:max-w-[12rem]">{r.label}</CellText> },
    { key: 'entityType', header: 'Type', mobile: 'meta', render: r => typeName(r.entityType) },
    { key: 'deletedByName', header: 'Deleted by', maxWidth: '12rem', mobile: 'meta', render: r => r.deletedByName ?? 'System' },
    {
      key: 'deletedAt', header: 'Deleted', mobile: 'meta',
      render: r => <span className="tabular-nums" title={formatDateTimeAu(r.deletedAt, zone)}>{formatDateTimeAu(r.deletedAt, zone)}</span>,
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
