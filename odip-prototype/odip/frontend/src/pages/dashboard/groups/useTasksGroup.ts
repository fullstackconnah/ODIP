import { useQueryClient } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import { useCompleteTask, useTasks } from '@/api/hooks'
import { TASK_TYPE_LABELS, type TaskDto } from '@/api/types'
import { formatDayMonth } from '@/lib/dateRange'
import { groupPhase, type GroupModel, type QuickRow, type RowAction } from '../quickGroupModel'

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 }
const isOpen = (t: TaskDto) => t.status !== 'Completed' && t.status !== 'Cancelled'
const dueDay = (t: TaskDto) => t.dueDate?.slice(0, 10) ?? ''

/** The Tasks due group (SHAPE §5, call 11): overdue, then due today, ticked with the server's own Done, which writes the completion only. */
export function useTasksGroup(enabled: boolean, { today, mayCloseBudgetReview }: { today: string; mayCloseBudgetReview: boolean }): GroupModel {
  // Overdue is the server's own rule (the dashboard's Overdue figure); due today is the server's too (dueToday, on the provider's day, never the browser's). Both are full rows with their
  // notes, so Done never wipes them (the summary no longer carries task rows).
  const overdue = useTasks({ status: 'Overdue' }, { enabled })
  const dueOnToday = useTasks({ dueToday: 'true' }, { enabled })
  const completeTask = useCompleteTask()
  const qc = useQueryClient()

  const late = [...(overdue.data?.items ?? [])].sort((a, b) => dueDay(a).localeCompare(dueDay(b)))
  const lateIds = new Set(late.map((t) => t.id))
  const dueToday = (dueOnToday.data?.items ?? [])
    .filter((t) => isOpen(t) && !lateIds.has(t.id))
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))

  const row = (t: TaskDto, isLate: boolean): QuickRow => {
    // Only an Admin or SuperAdmin closes the review of an emergency over budget (BudgetReviewAudience.MayAct, TasksPage's mayChange): a Coordinator opens it.
    const signOff = t.taskType === 'BudgetEmergencyReview' && !mayCloseBudgetReview
    const done: RowAction = {
      kind: 'tap', label: 'Done', busyLabel: 'Saving…', name: `Done: ${t.title}`, failText: "Couldn't mark it done. Try again.",
      run: async () => {
        // Read the task as it is NOW to say why a row is skipped; the write (POST /tasks/{id}/complete) sets status and date only, so nothing changed since the list loaded is undone.
        const fresh = await apiGet<TaskDto>(`/tasks/${t.id}`)
        if (!isOpen(fresh)) {
          void overdue.refetch(); void dueOnToday.refetch()
          return { announce: `Already ${fresh.status.toLowerCase()} by someone else.`, stale: true }
        }
        if (fresh.taskType === 'LeaveCoverage' || (fresh.taskType === 'BudgetEmergencyReview' && !mayCloseBudgetReview)) {
          void overdue.refetch(); void dueOnToday.refetch()
          return { announce: 'Task changed. Open the full task workflow before marking it done.', stale: true, keep: true }
        }
        await completeTask.mutateAsync({ id: t.id, completedDate: today })
        return { announce: `Marked done: ${t.title}.` }
      },
    }
    const actions: RowAction[] =
      // A leave cover task closes itself when the shift is reassigned: it is never ticked by hand. Its own link (the server writes /rostering?date=<the shift's day>) opens the board there.
      t.taskType === 'LeaveCoverage' ? [{ kind: 'link', label: 'Open roster', name: `Open roster for: ${t.title}`, to: t.linkTo ?? '/rostering' }]
      : signOff ? [{ kind: 'link', label: 'Open', name: `Open task: ${t.title}`, to: t.linkTo ?? `/tasks/${t.id}/edit` }]
      : t.linkTo ? [{ kind: 'link', label: 'Open', name: `Open task: ${t.title}`, to: t.linkTo }, done]
      : [done]
    return {
      id: t.id,
      subject: t.title,
      facts: [TASK_TYPE_LABELS[t.taskType], formatDayMonth(t.dueDate), t.priority, t.tripName],
      // Why the row has no Done is a flag, which never truncates.
      flags: [isLate ? { label: 'Overdue', tone: 'danger' } : { label: 'Due today', tone: 'warning' }, ...(signOff ? [{ label: 'An admin signs this off', tone: 'neutral' as const }] : [])],
      actions,
    }
  }

  const rows = [...late.map((t) => row(t, true)), ...dueToday.map((t) => row(t, false))]
  return {
    key: 'tasks',
    title: 'Tasks',
    noun: 'tasks due',
    subjectHeader: 'Task',
    // The trip is on a card only from lg: one tap away, and the longest wrap on a phone.
    columns: [{ header: 'Type' }, { header: 'Due' }, { header: 'Priority' }, { header: 'Trip', long: true, fromLg: true }],
    phase: groupPhase(overdue, dueOnToday),
    refetch: () => { void overdue.refetch(); void dueOnToday.refetch() },
    readAt: Math.min(overdue.dataUpdatedAt, dueOnToday.dataUpdatedAt),
    reread: async () => {
      try {
        const [o, d] = await Promise.all([overdue.refetch({ throwOnError: true }), dueOnToday.refetch({ throwOnError: true })])
        return [...(o.data?.items ?? []), ...(d.data?.items ?? []).filter(isOpen)].map((t) => t.id)
      } finally {
        // A Done with no reply never ran its onSuccess, and may have committed: refresh what it would have (useCompleteTask).
        void qc.invalidateQueries({ queryKey: ['tasks'] })
        void qc.invalidateQueries({ queryKey: ['trip-tasks'] })
        void qc.invalidateQueries({ queryKey: ['dashboard'] })
      }
    },
    // shortcut: overdue past the server cap are added from its total; due-today past the cap is not (closed rows can't be dropped client-side), upgrade = an open filter on dueToday.
    count: rows.length + Math.max(0, (overdue.data?.totalCount ?? 0) - (overdue.data?.items.length ?? 0)),
    rows,
    link: { to: '/tasks', openLabel: 'Open tasks' },
  }
}
