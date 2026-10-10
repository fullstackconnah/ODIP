import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPostRaw, apiPut, apiDelete } from '../client'
import { refreshBudgetFigures } from './funding-ledger'
import { awaitsData } from '@/lib/queryPhase'
import type {
  RosterBoardDto,
  ShiftDto,
  CreateShiftDto,
  UpdateShiftDto,
  AssignShiftDto,
  CheckShiftDto,
  ShiftCheckResult,
  RosterFindingDto,
  ShiftPatternDto,
  CreateShiftPatternDto,
  UpdateShiftPatternDto,
  GeneratePatternResultDto,
  CompatibilityRowDto,
  UpsertCompatibilityDto,
  ShiftNoteDto,
  FlaggedShiftNoteDto,
  ShiftStatus,
  ShiftCompletionDto,
  ShiftCompletionReviewDto,
  CompletionQueueItemDto,
  ReturnCompletionDto,
  ApproveBatchResultDto,
  PagedResult,
} from '../types'

// ══════════════════════════════════════════════════════════════
// ROSTER BOARD
// ══════════════════════════════════════════════════════════════

export function useRosterBoard(weekStart: string | undefined, groupBy: 'participant' | 'staff' = 'participant') {
  return useQuery({
    queryKey: ['roster-board', weekStart, groupBy],
    queryFn: () => apiGet<RosterBoardDto>('/rostering/board', { weekStart, groupBy }),
    enabled: !!weekStart,
  })
}

/**
 * Dry-run findings for a candidate shift — a POST that writes nothing. Used to preview
 * findings before a create/edit/assign is submitted, e.g. while the coordinator is still
 * filling out the shift editor. Never invalidates the board query.
 */
export function useCheckShift() {
  return useMutation({
    // The envelope's message carries the one informational line a shift the budget could not check gets ("Budget not checked: ..."): not a finding, so it does not travel in the list.
    mutationFn: async (data: CheckShiftDto): Promise<ShiftCheckResult> => {
      const response = await apiPostRaw<RosterFindingDto[]>('/rostering/shifts/check', data)
      return { findings: response.data ?? [], budgetNote: response.message ?? undefined }
    },
  })
}

export function useCreateShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateShiftDto) => apiPost<ShiftDto>('/rostering/shifts', data),
    onSuccess: (_, data) => {
      refreshBudgetFigures(qc, [data.participantId])   // a new shift is booked ahead in its participant's budget
      qc.invalidateQueries({ queryKey: ['tasks'] })   // an emergency save raises the Admin's review task in the same write: the Tasks list must not be served stale
      return qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useUpdateShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateShiftDto }) =>
      apiPut<ShiftDto>(`/rostering/shifts/${id}`, data),
    onSuccess: () => {
      refreshBudgetFigures(qc)   // its times, status or day changed what it costs, and where; the update names no participant, so every ledger held is refreshed
      qc.invalidateQueries({ queryKey: ['tasks'] })   // an emergency save raises the Admin's review task in the same write
      return qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useDeleteShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/rostering/shifts/${id}`),
    onSuccess: () => {
      refreshBudgetFigures(qc)   // a cancelled shift costs nothing
      return qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

/** Sets or clears a shift's staffId. Drives both drag-and-drop assignment and the chip menu's Assign/Unassign actions. */
export function useAssignShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AssignShiftDto }) =>
      apiPost<ShiftDto>(`/rostering/shifts/${id}/assign`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roster-board'] }),
  })
}

/**
 * Read-only shift notes (NOTES-01) for the roster slide-over — coordinators/admins read via
 * this surface; only the assigned worker creates/edits their own, via the portal hooks.
 * Only fetched once a shift actually exists (edit mode), same lazy pattern as
 * useParticipantRoutines/useCompatibility above.
 */
export function useRosterShiftNotes(shiftId: string | undefined) {
  return useQuery({
    queryKey: ['roster-shift-notes', shiftId],
    queryFn: () => apiGet<ShiftNoteDto[]>(`/rostering/shifts/${shiftId}/notes`),
    enabled: !!shiftId,
  })
}

export interface FlaggedShiftNotesFilters {
  withoutIncident?: boolean
  from?: string
  to?: string
}

/**
 * Connection map item 4: coordinator-facing queue of flagged shift notes across all shifts
 * (IncidentsPage's "Flagged notes" tab) — GET /rostering/flagged-notes?withoutIncident=&from=&to=,
 * oldest first, coordinator roles only server-side. `options.enabled` lets a caller that isn't
 * permitted to view this (e.g. IncidentsPage rendered for a SupportWorker) skip the request
 * entirely rather than firing one the backend would 403 — hooks can't be called conditionally,
 * so the gate has to live here rather than around the call site.
 */
export function useFlaggedShiftNotes(filters: FlaggedShiftNotesFilters = {}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['flagged-shift-notes', filters],
    queryFn: () => apiGet<FlaggedShiftNoteDto[]>('/rostering/flagged-notes', {
      withoutIncident: filters.withoutIncident,
      from: filters.from,
      to: filters.to,
    }),
    enabled: options?.enabled ?? true,
  })
}

// ══════════════════════════════════════════════════════════════
// SHIFT COMPLETION REVIEW (design spec §2/§4)
// ══════════════════════════════════════════════════════════════

export type CompletionFilters = { status?: ShiftStatus; from?: string; to?: string }

/**
 * The review queue — GET /rostering/completions?status=&from=&to=&page=&pageSize=, defaulting
 * to page 1/50 same as the backend's own defaults. Polled every 60s (like useLeaveRequests) so
 * the sidebar badge and this page's default PendingReview filter both stay fresh. There is no
 * staffId query param on this endpoint (see RosteringController.GetCompletions) — a staff filter
 * on CompletionReviewPage is applied client-side over the fetched page, same "doesn't filter
 * server-side" caveat useLeaveRequests documents for its own from/to.
 */
export function useCompletions(filters: CompletionFilters = {}, page = 1, pageSize = 50, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['rostering-completions', filters, page, pageSize],
    queryFn: () => apiGet<PagedResult<CompletionQueueItemDto>>('/rostering/completions', { ...filters, page, pageSize }),
    refetchInterval: 60_000,
    enabled: options?.enabled ?? true,
  })
}

/**
 * The coordinator's one-call review of a submitted shift — GET /rostering/shifts/{id}/completion/review: the completion (breaks,
 * net worked minutes, handover, nothing-to-note), every scheduled dose in the rostered window with its outcome, PRN doses given
 * during the shift, and the shift notes. Read-only; Approve / Return are the existing mutations.
 */
export function useShiftCompletionReview(shiftId: string | undefined) {
  return useQuery({
    queryKey: ['rostering-completion-review', shiftId],
    queryFn: () => apiGet<ShiftCompletionReviewDto>(`/rostering/shifts/${shiftId}/completion/review`),
    enabled: !!shiftId,
  })
}

/**
 * Lazily-fetched completion detail (incidents included) for one shift — used on expand/before
 * Approve/Return so the queue itself never N+1s a detail call per row.
 */
export function useCompletion(shiftId: string | undefined) {
  return useQuery({
    queryKey: ['rostering-completion', shiftId],
    queryFn: () => apiGet<ShiftCompletionDto>(`/rostering/shifts/${shiftId}/completion`),
    enabled: !!shiftId,
  })
}

export function useApproveCompletion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (shiftId: string) => apiPost<ShiftCompletionDto>(`/rostering/shifts/${shiftId}/completion/approve`),
    onSuccess: (_, shiftId) => {
      qc.invalidateQueries({ queryKey: ['rostering-completions'] })
      qc.invalidateQueries({ queryKey: ['rostering-completion', shiftId] })
      qc.invalidateQueries({ queryKey: ['rostering-completion-review', shiftId] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
      refreshBudgetFigures(qc)   // an approved completion is a completed shift: booked ahead becomes pending
    },
  })
}

export function useReturnCompletion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ shiftId, data }: { shiftId: string; data: ReturnCompletionDto }) =>
      apiPost<ShiftCompletionDto>(`/rostering/shifts/${shiftId}/completion/return`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['rostering-completions'] })
      qc.invalidateQueries({ queryKey: ['rostering-completion', vars.shiftId] })
      qc.invalidateQueries({ queryKey: ['rostering-completion-review', vars.shiftId] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

/** POST /rostering/completions/approve-batch — up to 100 ids, per-item results even on partial failure. */
export function useApproveCompletionsBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (shiftIds: string[]) =>
      apiPost<ApproveBatchResultDto[]>('/rostering/completions/approve-batch', { shiftIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rostering-completions'] })
      // Any open review is now stale: a batch names many shifts, and the prefix key covers every one of them.
      qc.invalidateQueries({ queryKey: ['rostering-completion-review'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
      refreshBudgetFigures(qc)   // each approved completion moves its shift from booked ahead to pending
    },
  })
}

/**
 * Sidebar/nav badge count — a separate ['rostering-completions', ...] cache entry from the review
 * page's own default view (pageSize 1 here vs the page's 50): PagedResult.totalCount is a
 * server-computed total independent of how many items the page slice returns, so a pageSize-1
 * request is enough to read the count without pulling the full page just for a badge. `enabled`
 * lets a caller like AppLayout gate the poll on `canReviewCompletions`, mirroring
 * usePendingLeaveCount's gate on `canApproveLeave`.
 */
export function usePendingCompletionCount(enabled = true): number {
  return usePendingCompletionQueue(enabled).count
}

/**
 * The same queue with what its count rests on: `loading` while the request is waiting (in flight, or paused while the browser is offline: `awaitsData`) and
 * `error` once it has failed, so a caller can tell "nothing is waiting" from "we do not know yet" (a count is 0 in both of those states). The dashboard reads it so it never says nothing needs
 * anybody while shifts wait for review, which is what the Staff & roster badge counts. `usePendingCompletionCount` is this hook's count alone,
 * and both read the one cache entry.
 */
export function usePendingCompletionQueue(enabled = true): { count: number; loading: boolean; error: boolean } {
  const queue = useCompletions({ status: 'PendingReview' }, 1, 1, { enabled })
  return { count: queue.data?.totalCount ?? 0, loading: awaitsData(queue), error: queue.isError }
}

// ══════════════════════════════════════════════════════════════
// SHIFT PATTERNS
// ══════════════════════════════════════════════════════════════

export function usePatterns(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['roster-patterns', params],
    queryFn: () => apiGet<ShiftPatternDto[]>('/rostering/patterns', params),
  })
}

export function useCreatePattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateShiftPatternDto) => apiPost<ShiftPatternDto>('/rostering/patterns', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roster-patterns'] }),
  })
}

export function useUpdatePattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateShiftPatternDto }) =>
      apiPut<ShiftPatternDto>(`/rostering/patterns/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['roster-patterns'] })
      qc.invalidateQueries({ queryKey: ['roster-pattern', vars.id] })
    },
  })
}

export function useDeletePattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/rostering/patterns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roster-patterns'] }),
  })
}

/**
 * Materialises shifts from a pattern into the given date range. Generation is idempotent
 * server-side (dates already carrying a shift with this ShiftPatternId are skipped), so
 * invalidating the board is safe to call repeatedly.
 */
export function useGeneratePattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, from, to }: { id: string; from: string; to: string }) =>
      apiPost<GeneratePatternResultDto>(`/rostering/patterns/${id}/generate?${new URLSearchParams({ from, to })}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster-board'] })
      qc.invalidateQueries({ queryKey: ['roster-patterns'] })
      refreshBudgetFigures(qc)   // the shifts it makes are booked ahead
    },
  })
}

// ══════════════════════════════════════════════════════════════
// STAFF / PARTICIPANT COMPATIBILITY
// ══════════════════════════════════════════════════════════════

export function useCompatibility(participantId: string | undefined) {
  return useQuery({
    queryKey: ['roster-compatibility', participantId],
    queryFn: () => apiGet<CompatibilityRowDto[]>('/rostering/compatibility', { participantId }),
    enabled: !!participantId,
  })
}

export function useUpsertCompatibility() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpsertCompatibilityDto) => apiPut<CompatibilityRowDto>('/rostering/compatibility', data),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['roster-compatibility', vars.participantId] }),
  })
}

// ══════════════════════════════════════════════════════════════
// SHARED ERROR HELPERS
// ══════════════════════════════════════════════════════════════

/**
 * A write endpoint (create/update/assign) rejects with 422 when the candidate carries a
 * Blocking finding, or carries Warnings without an overrideReason. The findings travel in
 * the same ApiResponse envelope as a success would (`response.data.data`), so this pulls
 * them out of an unknown thrown error for the UI to render and act on.
 */
export function getRosterFindings(err: unknown): RosterFindingDto[] | null {
  const axiosErr = err as { response?: { status?: number; data?: { data?: unknown } } }
  if (axiosErr?.response?.status !== 422) return null
  const findings = axiosErr.response.data?.data
  return Array.isArray(findings) ? (findings as RosterFindingDto[]) : null
}
