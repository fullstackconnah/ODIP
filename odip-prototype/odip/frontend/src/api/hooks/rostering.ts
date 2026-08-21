import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut, apiDelete } from '../client'
import type {
  RosterBoardDto,
  ShiftDto,
  CreateShiftDto,
  UpdateShiftDto,
  AssignShiftDto,
  CheckShiftDto,
  RosterFindingDto,
  ShiftPatternDto,
  CreateShiftPatternDto,
  UpdateShiftPatternDto,
  CompatibilityRowDto,
  UpsertCompatibilityDto,
} from '../types'

// ══════════════════════════════════════════════════════════════
// ROSTER BOARD
// ══════════════════════════════════════════════════════════════

export function useRosterBoard(weekStart: string | undefined) {
  return useQuery({
    queryKey: ['roster-board', weekStart],
    queryFn: () => apiGet<RosterBoardDto>('/rostering/board', { weekStart }),
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
    mutationFn: (data: CheckShiftDto) => apiPost<RosterFindingDto[]>('/rostering/shifts/check', data),
  })
}

export function useCreateShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateShiftDto) => apiPost<ShiftDto>('/rostering/shifts', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roster-board'] }),
  })
}

export function useUpdateShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateShiftDto }) =>
      apiPut<ShiftDto>(`/rostering/shifts/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roster-board'] }),
  })
}

export function useDeleteShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/rostering/shifts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roster-board'] }),
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

// ══════════════════════════════════════════════════════════════
// SHIFT PATTERNS
// ══════════════════════════════════════════════════════════════

export function usePatterns(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['roster-patterns', params],
    queryFn: () => apiGet<ShiftPatternDto[]>('/rostering/patterns', params),
  })
}

export function usePattern(id: string | undefined) {
  return useQuery({
    queryKey: ['roster-pattern', id],
    queryFn: () => apiGet<ShiftPatternDto>(`/rostering/patterns/${id}`),
    enabled: !!id,
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
      apiPost<ShiftDto[]>(`/rostering/patterns/${id}/generate?${new URLSearchParams({ from, to })}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster-board'] })
      qc.invalidateQueries({ queryKey: ['roster-patterns'] })
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
