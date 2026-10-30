import { useTasks, useSetTaskStatus, useDeleteTask } from '@/api/hooks'
import { TASK_TYPE_LABELS, type TaskItemStatus } from '@/api/types'
import { DataTable, RowActions, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/Button'
import { getStatusColor } from '@/lib/utils'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Filter, CheckCircle, Plus, ListChecks, Eye } from 'lucide-react'
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

  const { showArchived, params, toggleButtons, confirmDialog, errorNotice, actionButtons } = useArchiveRestore<any>({
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
  const { data: tasks = [], isLoading, isError, refetch } = pageQuery
  const markComplete = (e: React.MouseEvent, task: any) => {
    e.stopPropagation()
    setStatus.mutate({ id: task.id, status: 'Completed', completedDate: localIsoDate() }, {
      onError: () => setFailedRowId(task.id),
      onSuccess: () => setFailedRowId(prev => prev === task.id ? null : prev),
    })
  }

  const taskColumns: Column<any>[] = [
    {
      key: 'checkbox',
      header: '',
      hidden: showArchived,
      // On the card the tick joins the controls after Due, so Due holds its place on a card without one.
      className: 'max-md:order-1',
      render: (t) => t.status !== 'Completed' && t.status !== 'Cancelled' && mayChange(t) ? (
        <Button variant="ghost" size="sm" iconOnly onClick={(e) => markComplete(e, t)} title="Mark complete" className="max-md:min-h-11 max-md:min-w-11">
          <CheckCircle className="w-4 h-4" />
        </Button>
      ) : null,
    },
    // Column budget (density §4): at 1280 the box is ~1006px and the fixed columns (tick, due, priority, status, Open, actions)
    // take ~500 of it, so the text columns are capped (an ellipsis, full text in the tooltip). Every column stays (Trip and Type were
    // deleted below 1536 and 1792, L3-04): what does not fit scrolls in the box with the task and the actions pinned. Task 13rem, Trip
    // 9rem and Type 8rem keep Status clear of the pinned actions at 1440 (it was cut to "Sta", platform review V2-B).
    // On the phone card the title and status make the title line, trip, type, owner and priority one muted line, and Due stays labelled.
    {
      key: 'title',
      header: 'Task',
      sortable: true,
      mobile: 'primary',
      className: 'font-medium',
      maxWidth: '13rem',
      // The title is the way in when the task has one (this column is pinned, so it is always reachable; "Open" stays for the habit). The review of an emergency names the participant and the day LAST, which is
      // exactly what a one-line cap cuts, so its title wraps instead and the row says which emergency it is. Every other title is cut on the link itself (a wrapper would clip its focus ring).
      render: (t) => t.linkTo ? (
        <Link
          to={t.linkTo}
          title={t.title}
          className={`text-[var(--color-primary)] hover:underline ${isBudgetReview(t) ? 'whitespace-normal md:max-w-[13rem]' : 'block md:truncate md:max-w-[13rem]'}`}
        >
          {t.title}
        </Link>
      ) : isBudgetReview(t) ? (
        <span className="block whitespace-normal md:max-w-[13rem]" title={t.title}>{t.title}</span>
      ) : isReadOnly ? (
        // ReadOnly has no Edit action: the title opens the task as a view (the only place its notes are shown).
        <Link to={`/tasks/${t.id}/edit`} title={t.title} className="block text-[var(--color-primary)] hover:underline md:truncate md:max-w-[13rem]">{t.title}</Link>
      ) : t.title,
    },
    {
      key: 'tripName',
      header: 'Trip',
      sortable: true,
      maxWidth: '9rem',
      mobile: 'meta',
      render: (t) => t.tripInstanceId && t.tripName ? (
        // Truncation on the link itself (not a wrapper): a wrapper's overflow: hidden would clip the link's focus ring.
        <Link to={`/trips/${t.tripInstanceId}`} title={t.tripName} className="block truncate text-[var(--color-primary)] hover:underline md:max-w-[9rem]">
          {t.tripName}
        </Link>
      ) : (t.tripName ?? '—'),
    },
    { key: 'taskType', header: 'Type', sortable: true, maxWidth: '8rem', mobile: 'meta', render: (t) => TASK_TYPE_LABELS[t.taskType as keyof typeof TASK_TYPE_LABELS] ?? t.taskType },
    // Nobody owns the review of an emergency until an Admin takes it, and it is the Admins' to take: say so rather than a dash that reads as "nobody's job".
    { key: 'ownerName', header: 'Owner', sortable: true, maxWidth: '8rem', mobile: 'meta', render: (t) => t.ownerName ?? (isBudgetReview(t) ? 'Admins' : '—') },
    { key: 'dueDate', header: 'Due', type: 'date', sortable: true },
    {
      key: 'priority',
      header: 'Priority',
      mobile: 'meta',
      render: (t) => <StatusBadge status={t.priority} />,
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
      key: 'linkTo',
      header: '',
      render: (t) => t.linkTo ? (
        <Link to={t.linkTo} className="text-[var(--color-primary)] hover:underline">
          Open
        </Link>
      ) : null,
    },
    // ReadOnly has no Edit: View opens the task itself, which a linked task's title does not (it goes to the linked page).
    // On a mouse the cluster overlays the row's last cells (RowActions overlay) instead of holding a column, so "Open" is not cut at 1440.
    { key: 'actions', header: '', className: 'relative', render: (t) => mayChange(t) ? <RowActions overlay>{actionButtons(t)}</RowActions> : isReadOnly && !isBudgetReview(t) ? (
      <RowActions overlay>
        <Button to={`/tasks/${t.id}/edit`} variant="ghost" size="sm" iconOnly title="View" aria-label="View">
          <Eye className="w-4 h-4" />
        </Button>
      </RowActions>
    ) : null },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Tasks"
        subtitle={plural(tasks.length, 'task')}
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
