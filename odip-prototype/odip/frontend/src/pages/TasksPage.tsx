import { useTasks, useSetTaskStatus, useDeleteTask } from '@/api/hooks'
import { TASK_TYPE_LABELS, type TaskItemStatus } from '@/api/types'
import { CellText, DataTable, RowMenu, ROW_LINK, CROSS_LINK, type Column, type RowMenuItem } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/Button'
import { getStatusColor, formatDateAu } from '@/lib/utils'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Filter, CheckCircle, Plus, ListChecks, Eye, Pencil, Archive, ArchiveRestore } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { plural } from '@/lib/format'
import { localIsoDate } from '@/lib/dateOnly'
import { retryingAfterError } from '@/lib/queryPhase'

const TASK_STATUS_ITEMS = [
  { value: 'NotStarted', label: 'Not Started' },
  { value: 'InProgress', label: 'In Progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Overdue', label: 'Overdue' },
  { value: 'Cancelled', label: 'Cancelled' },
]

/** The Admin's review of an emergency booking over budget. Only an Admin or SuperAdmin closes it: the server forbids everyone else, so this page does not offer what it would refuse. */
const isBudgetReview = (task: { taskType?: string }) => task.taskType === 'BudgetEmergencyReview'

export default function TasksPage() {
  const { canWrite, isAdmin, isSuperAdmin, isReadOnly } = usePermissions()
  const mayCloseBudgetReview = !!isAdmin || !!isSuperAdmin
  // The one place the rule lives: a row the user may not change gets no tick, a held status and no edit or archive.
  const mayChange = (task: { taskType?: string }) => canWrite && (!isBudgetReview(task) || mayCloseBudgetReview)
  // The dashboard's Overdue tile links to /tasks?status=Overdue: open on that filter (the server answers it with the dashboard's own rule).
  const [searchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState(() => {
    const fromAddress = searchParams.get('status')
    return TASK_STATUS_ITEMS.some(item => item.value === fromAddress) ? fromAddress! : ''
  })
  const [failedRowId, setFailedRowId] = useState<string | null>(null)
  const setStatus = useSetTaskStatus()
  const deleteTask = useDeleteTask()

  const { showArchived, params, toggleButtons, confirmDialog, errorNotice, requestArchive, requestRestore } = useArchiveRestore<any>({
    deleteMutation: deleteTask,
    // Restore posts the status alone, so it cannot revert an edit made since the list loaded (an update rewrites the whole row).
    restoreMutation: { mutate: ({ id }, options) => setStatus.mutate({ id, status: 'NotStarted' }, options), isPending: setStatus.isPending },
    entityName: (t) => t.title,
    entityId: (t) => t.id,
    archiveVia: 'status',
    archiveStatus: 'Cancelled',
    editPath: (t) => `/tasks/${t.id}/edit`,
  })

  // Merge status filter with archive params — when not archived and a filter is active, override status
  const queryParams = { ...params }
  if (!showArchived && statusFilter) queryParams.status = statusFilter

  const pageQuery = useTasks(queryParams)
  const { data, isLoading, isError, refetch } = pageQuery
  // The server sends the 500 soonest due and the true total; the table sorts only the rows it holds.
  const tasks = data?.items ?? []
  const total = data?.totalCount ?? 0
  const markComplete = (e: React.MouseEvent, task: any) => {
    e.stopPropagation()
    setStatus.mutate({ id: task.id, status: 'Completed', completedDate: localIsoDate() }, {
      onError: () => setFailedRowId(task.id),
      onSuccess: () => setFailedRowId(prev => prev === task.id ? null : prev),
    })
  }

  // The menu a row offers, once: icon buttons on a mouse, one ⋯ on the phone card. Archive is undoable (a confirm, then Archived), so it is never red.
  const rowItems = (t: { id: string; taskType?: string }): RowMenuItem[] => mayChange(t)
    ? [
        { label: 'Edit', icon: <Pencil className="w-4 h-4" />, to: `/tasks/${t.id}/edit` },
        showArchived
          ? { label: 'Restore', icon: <ArchiveRestore className="w-4 h-4" />, onSelect: () => requestRestore(t) }
          : { label: 'Archive', icon: <Archive className="w-4 h-4" />, onSelect: () => requestArchive(t) },
      ]
    : isReadOnly && !isBudgetReview(t) ? [{ label: 'View', icon: <Eye className="w-4 h-4" />, to: `/tasks/${t.id}/edit` }] : []

  const taskColumns: Column<any>[] = [
    {
      key: 'checkbox',
      header: '',
      srHeader: 'Mark complete',
      hidden: showArchived,
      // On the phone card the tick is the row's one visible action, ahead of the ⋯ menu at the end of the meta line.
      mobile: 'trail',
      render: (t) => t.status !== 'Completed' && t.status !== 'Cancelled' && mayChange(t) ? (
        <Button variant="ghost" size="sm" iconOnly onClick={(e) => markComplete(e, t)} title="Mark complete" className="max-md:min-h-11 max-md:min-w-11">
          <CheckCircle className="w-4 h-4" />
        </Button>
      ) : null,
    },
    // Column budget (density §4): at 1280 the box is ~1006px. Order is identity, status, when, then the rest, so Status is on screen before the
    // table scrolls (it sat late and fell under the pinned actions, "In Progre"). Every column stays (L3-04): what does not fit scrolls under the
    // edge fade, with the task pinned. Task 13rem (two lines), Trip 9rem, Owner and Type 7rem.
    // On the phone card the title and status make the title line; due, priority, trip and owner are one muted line, and the type is on the task.
    {
      key: 'title',
      header: 'Task',
      sortable: true,
      mobile: 'primary',
      wrap: true,
      className: 'font-medium',
      // The title is the way in when the task has one, so there is no separate "Open" column. The review of an emergency names the participant and the day LAST,
      // which a one-line cap cuts, so every title gets two lines before an ellipsis, with the full text in the tooltip. The cap sits on the link itself (a wrapper would clip its focus ring).
      render: (t) => t.linkTo ? (
        <Link to={t.linkTo} title={t.title} className={`line-clamp-2 break-words md:max-w-[13rem] ${ROW_LINK}`}>{t.title}</Link>
      ) : isReadOnly && !isBudgetReview(t) ? (
        // ReadOnly has no Edit action: the title opens the task as a view (the only place its notes are shown).
        <Link to={`/tasks/${t.id}/edit`} title={t.title} className={`line-clamp-2 break-words md:max-w-[13rem] ${ROW_LINK}`}>{t.title}</Link>
      ) : <CellText lines={2} className="max-md:line-clamp-2 break-words md:max-w-[13rem]">{t.title}</CellText>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      mobile: 'status',
      // "Not Started" / "In Progress" swap in place: reserve the widest so the column does not jump.
      minWidth: '9rem',
      // A role that cannot write reads the status; one that can but may not change this row (the emergency review) gets a held pill.
      render: (t) => !canWrite ? <StatusBadge status={t.status} label={TASK_STATUS_ITEMS.find(i => i.value === t.status)?.label} /> : (
        <div>
          <Dropdown
            variant="pill"
            value={t.status}
            onChange={val => {
              setFailedRowId(null)
              setStatus.mutate({
                id: t.id,
                status: val as TaskItemStatus,
                ...(val === 'Completed' ? { completedDate: localIsoDate() } : {}),
              }, {
                onError: () => setFailedRowId(t.id),
                onSuccess: () => setFailedRowId(prev => prev === t.id ? null : prev),
              })
            }}
            colorClass={getStatusColor(t.status)}
            items={TASK_STATUS_ITEMS}
            disabled={!mayChange(t)}
          />
          {failedRowId === t.id && (
            <p role="alert" className="mt-1 text-xs text-[var(--color-destructive)]">
              Couldn't update status. Try again.
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      type: 'date',
      sortable: true,
      mobile: 'meta',
      render: (t) => <span className="whitespace-nowrap"><span className="md:hidden">Due </span>{formatDateAu(t.dueDate)}</span>,
    },
    {
      key: 'priority',
      header: 'Priority',
      mobile: 'meta',
      render: (t) => <StatusBadge status={t.priority} />,
    },
    {
      key: 'tripName',
      header: 'Trip',
      sortable: true,
      maxWidth: '9rem',
      mobile: 'meta',
      render: (t) => t.tripInstanceId && t.tripName ? (
        // Truncation on the link itself (not a wrapper): a wrapper's overflow: hidden would clip the link's focus ring.
        <Link to={`/trips/${t.tripInstanceId}`} title={t.tripName} className={`block truncate md:max-w-[9rem] ${CROSS_LINK}`}>
          {t.tripName}
        </Link>
      ) : (t.tripName ?? '—'),
    },
    // Nobody owns the review of an emergency until an Admin takes it, and it is the Admins' to take: say so rather than a dash that reads as "nobody's job".
    { key: 'ownerName', header: 'Owner', sortable: true, maxWidth: '7rem', mobile: 'meta', className: 'max-md:max-w-[8rem]!', render: (t) => t.ownerName ?? (isBudgetReview(t) ? 'Admins' : '—') },
    { key: 'taskType', header: 'Type', sortable: true, maxWidth: '7rem', mobile: 'hidden', render: (t) => TASK_TYPE_LABELS[t.taskType as keyof typeof TASK_TYPE_LABELS] ?? t.taskType },
    // The cluster overlays the row's last cells on a mouse and costs no column (RowMenu, overlay), so nothing is cut at 1440; one ⋯ menu on the phone card.
    { key: 'actions', header: '', overlay: true, mobile: 'trail', render: (t) => <RowMenu name={t.title} items={rowItems(t)} /> },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Tasks"
        subtitle={plural(total, 'task')}
        action={!showArchived && canWrite && (
          <Button to="/tasks/new" size="md">
            <Plus className="w-4 h-4" /> New task
          </Button>
        )}
      >
        {toggleButtons}
        {!showArchived && (
          <div className="flex items-center gap-1.5">
            <Filter aria-hidden="true" className="w-4 h-4 text-[var(--color-muted-foreground)]" />
            <Dropdown
              variant="pill"
              value={statusFilter}
              onChange={setStatusFilter}
              label="All Statuses"
              items={TASK_STATUS_ITEMS}
              colorClass="bg-[var(--color-input)] border border-[var(--color-border)]"
            />
          </div>
        )}
      </PageHeader>

      {errorNotice}

      {!isLoading && !isError && total > tasks.length && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Showing the first {tasks.length} of {total} {showArchived ? 'archived ' : ''}tasks, soonest due first.{!showArchived && !statusFilter && ' Choose a status to narrow the list.'}
        </p>
      )}

      {!isLoading && !isError && tasks.length === 0 ? (
        !showArchived && statusFilter ? (
          <EmptyState
            icon={ListChecks}
            title="No tasks match your filters"
            description="Try a different status filter, or clear it to see all tasks."
            action={{ label: 'Clear filters', onClick: () => setStatusFilter('') }}
          />
        ) : (
          <EmptyState
            icon={ListChecks}
            title="No tasks yet"
            description="Tasks track the to-dos for a trip — accommodation confirmations, vehicle requests, medication checks and more. Add one to start tracking work."
          />
        )
      ) : (
        <DataTable
          data={tasks}
          columns={taskColumns}
          keyField="id"
          sortable
          loading={isLoading}
          error={isError || retryingAfterError(pageQuery)}
          onRetry={() => refetch()}
          emptyMessage="No tasks found"
        />
      )}
      {confirmDialog}
    </div>
  )
}
