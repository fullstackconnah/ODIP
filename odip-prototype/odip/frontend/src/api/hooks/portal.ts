import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPostRaw, apiPut, apiDeleteRaw } from '../client'
import type {
  PortalShiftsResponseDto, PortalShiftDetailDto, PortalWitnessRequestDto, ShiftNoteDto, StartShiftDto, FinishShiftDto,
  EditShiftBreakDto, AcknowledgeHandoverDto, CreateAdministrationDto, AdministrationDto,
} from '../types'

export function useMyShifts(from?: string, to?: string) {
  return useQuery({
    queryKey: ['portal-my-shifts', from, to],
    queryFn: () => apiGet<PortalShiftsResponseDto>('/portal/my-shifts', { from, to }),
  })
}

export function usePortalShiftDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['portal-shift-detail', id],
    queryFn: () => apiGet<PortalShiftDetailDto>(`/portal/shifts/${id}`),
    enabled: !!id,
  })
}

// ══════════════════════════════════════════════════════════════
// SHIFT COMPLETION (design spec §2/§4) — Start/Finish on the worker's own shift.
// ══════════════════════════════════════════════════════════════

/**
 * Invalidates the shift detail (status/completion flip to InProgress), the shift-notes cache
 * (harmless no-op here, kept only for symmetry with useFinishShift) and the my-shifts list (its
 * status chip needs to flip too) — same three-cache invalidation useFinishShift uses.
 */
export function useStartShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: StartShiftDto }) =>
      apiPost<PortalShiftDetailDto>(`/portal/shifts/${id}/start`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['portal-shift-detail', vars.id] })
      qc.invalidateQueries({ queryKey: ['portal-shift-notes', vars.id] })
      qc.invalidateQueries({ queryKey: ['portal-my-shifts'] })
    },
  })
}

export function useFinishShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: FinishShiftDto }) =>
      apiPost<PortalShiftDetailDto>(`/portal/shifts/${id}/finish`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['portal-shift-detail', vars.id] })
      qc.invalidateQueries({ queryKey: ['portal-shift-notes', vars.id] })
      qc.invalidateQueries({ queryKey: ['portal-my-shifts'] })
    },
  })
}

// ══════════════════════════════════════════════════════════════
// SHIFT PACKAGE (PR 1 contract) — breaks, handover acknowledgement, recording a dose from the shift.
// Every write that returns the shift detail replaces the cached detail in one step (setQueryData) and
// then refetches, so the page never shows a stale break timer or dose state. Error handling: a failed
// call rejects with the axios error; see lib/shiftPackageErrors.ts for reading `code` and `data`.
// ══════════════════════════════════════════════════════════════

function useShiftDetailWrite<TVars extends { id: string }>(mutationFn: (vars: TVars) => Promise<PortalShiftDetailDto>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (detail, vars) => {
      qc.setQueryData(['portal-shift-detail', vars.id], detail)
      qc.invalidateQueries({ queryKey: ['portal-shift-detail', vars.id] })
    },
  })
}

/** POST portal/shifts/{id}/breaks/start — 409 SHIFT_BREAK_ALREADY_RUNNING if a break is already running. */
export function useStartBreak() {
  return useShiftDetailWrite(({ id }: { id: string }) => apiPost<PortalShiftDetailDto>(`/portal/shifts/${id}/breaks/start`))
}

/** POST portal/shifts/{id}/breaks/{breakId}/end — idempotent. */
export function useEndBreak() {
  return useShiftDetailWrite(({ id, breakId }: { id: string; breakId: string }) =>
    apiPost<PortalShiftDetailDto>(`/portal/shifts/${id}/breaks/${breakId}/end`))
}

/** PUT portal/shifts/{id}/breaks/{breakId} — correct a break's times (UTC) before Finish. */
export function useEditBreak() {
  return useShiftDetailWrite(({ id, breakId, data }: { id: string; breakId: string; data: EditShiftBreakDto }) =>
    apiPut<PortalShiftDetailDto>(`/portal/shifts/${id}/breaks/${breakId}`, data))
}

/** DELETE portal/shifts/{id}/breaks/{breakId} — remove a break before Finish (audited). */
export function useDeleteBreak() {
  return useShiftDetailWrite(async ({ id, breakId }: { id: string; breakId: string }) => {
    const response = await apiDeleteRaw<PortalShiftDetailDto>(`/portal/shifts/${id}/breaks/${breakId}`)
    return response.data as PortalShiftDetailDto
  })
}

/**
 * POST portal/shifts/{id}/routines/{routineId}/check - tick a routine done (persisted on the shift's completion; audited). The caller's OWN
 * InProgress shift, and the routine must be one of `shiftRoutines` (404 SHIFT_ROUTINE_NOT_FOUND otherwise). Idempotent: ticking again keeps
 * the first who and when. Replaces the cached shift detail with the response (`shiftRoutines[].isChecked` / `checkedAt` / `checkedByName`).
 */
export function useCheckRoutine() {
  return useShiftDetailWrite(({ id, routineId }: { id: string; routineId: string }) =>
    apiPost<PortalShiftDetailDto>(`/portal/shifts/${id}/routines/${routineId}/check`))
}

/** DELETE portal/shifts/{id}/routines/{routineId}/check - untick a routine (the removal is audited). Idempotent; same scoping as `useCheckRoutine`. */
export function useUncheckRoutine() {
  return useShiftDetailWrite(async ({ id, routineId }: { id: string; routineId: string }) => {
    const response = await apiDeleteRaw<PortalShiftDetailDto>(`/portal/shifts/${id}/routines/${routineId}/check`)
    return response.data as PortalShiftDetailDto
  })
}

/**
 * POST portal/shifts/{id}/handover/ack — the next worker marks the latest handover read (who and when are recorded). Pass the
 * `completionId` of the handover on screen so a newer one arriving meanwhile is 409 SHIFT_HANDOVER_CHANGED, not a silent ack.
 */
export function useAcknowledgeHandover() {
  return useShiftDetailWrite(({ id, data }: { id: string; data?: AcknowledgeHandoverDto }) =>
    apiPost<PortalShiftDetailDto>(`/portal/shifts/${id}/handover/ack`, data ?? {}))
}

/**
 * POST portal/shifts/{id}/medications/{medicationId}/administrations — record a dose from the package. The caller's OWN shift,
 * InProgress; `scheduledAt` (the slot's wall-clock `scheduledAt`, unchanged) for a scheduled dose, omitted for PRN. "Not given" is
 * `status: 'Missed'` (or `Refused` / `Withheld`) with a `reason`; it says the dose was not given, it is not a hand-over (what the next worker needs
 * goes in the handover text). Send an `idempotencyKey`. 403 = no Medication Competency (Enforce mode only; in Warn mode the
 * dose is recorded and flagged `recordedWithoutCompetency`); 409 ADMINISTRATION_ALREADY_RECORDED carries the existing record as `data`. The
 * one exception to "a slot takes one record": a later `Administered` (or `WrongMedication`) supersedes an active `Refused`, `Withheld` or
 * `Missed` record (the participant refused then took it; a Missed record was wrong because the dose was given) - the earlier record is kept as
 * history and the slot then reads the new one. Nothing else is superseded: an `Administered` or `WrongMedication` record is final (409, `data` is
 * that record) and a not-given outcome never replaces another record. 422 ADMINISTRATION_TOO_EARLY: an Administered dose cannot be charted more than 60 minutes before its slot (the message says
 * from when); 422 ADMINISTRATION_TIME_OUT_OF_RANGE: `administeredAt` must lie between the shift's actual start and now + 5 minutes.
 * Refreshes the shift detail and the medication caches.
 * Every instant in the returned record (`administeredAt`, `createdAt`, ...) is UTC with a Z - on a replay and on the 409 body too;
 * `scheduledAt` stays the slot's provider-local wall-clock value. The same `idempotencyKey` may only be reused for the SAME dose
 * (medication, slot and outcome): reusing it for a different one is 400 ADMINISTRATION_IDEMPOTENCY_KEY_REUSED, never a silent replay.
 */
export function useRecordShiftDose() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ shiftId, medicationId, data }: { shiftId: string; medicationId: string; data: CreateAdministrationDto }) =>
      apiPost<AdministrationDto>(`/portal/shifts/${shiftId}/medications/${medicationId}/administrations`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['portal-shift-detail', vars.shiftId] })
      qc.invalidateQueries({ queryKey: ['mar'] })
      qc.invalidateQueries({ queryKey: ['participant-administrations'] })
    },
  })
}

// ══════════════════════════════════════════════════════════════
// SHIFT NOTES (NOTES-01)
// ══════════════════════════════════════════════════════════════

export function useShiftNotes(shiftId: string | undefined) {
  return useQuery({
    queryKey: ['portal-shift-notes', shiftId],
    queryFn: () => apiGet<ShiftNoteDto[]>(`/portal/shifts/${shiftId}/notes`),
    enabled: !!shiftId,
  })
}

export function useCreateShiftNote(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => apiPost<ShiftNoteDto>(`/portal/shifts/${shiftId}/notes`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-shift-notes', shiftId] }),
  })
}

export function useUpdateShiftNote(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => apiPut<ShiftNoteDto>(`/portal/notes/${id}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-shift-notes', shiftId] }),
  })
}

/** NOTES-02: dismisses the "file an incident report?" prompt on one flagged note — persisted server-side. */
export function useAcknowledgeShiftNoteFlags(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<ShiftNoteDto>(`/portal/notes/${id}/acknowledge-flags`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-shift-notes', shiftId] }),
  })
}

// Shared by the sidebar nav badge and the witness approvals page — same queryKey means both
// read from (and refresh) the same cached list rather than issuing separate requests.
// A 60s poll keeps the badge from going stale while someone's on another page.
export function usePendingWitnessRequests() {
  return useQuery({
    queryKey: ['portal-witness-requests'],
    queryFn: () => apiGet<PortalWitnessRequestDto[]>('/portal/witness-requests'),
    refetchInterval: 60_000,
  })
}

export function useApproveWitnessRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPostRaw<PortalWitnessRequestDto>(`/portal/witness-requests/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-witness-requests'] }),
  })
}

export function useDeclineWitnessRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPostRaw<PortalWitnessRequestDto>(`/portal/witness-requests/${id}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-witness-requests'] }),
  })
}

// IN-7: incident-side counterparts — a different table, and an optional witness statement the
// medication flow has no equivalent for.
export function useApproveIncidentWitnessRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statementText }: { id: string; statementText?: string }) =>
      apiPostRaw<PortalWitnessRequestDto>(`/portal/incident-witness-requests/${id}/approve`, { statementText }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-witness-requests'] }),
  })
}

export function useDeclineIncidentWitnessRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statementText }: { id: string; statementText?: string }) =>
      apiPostRaw<PortalWitnessRequestDto>(`/portal/incident-witness-requests/${id}/decline`, { statementText }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-witness-requests'] }),
  })
}
