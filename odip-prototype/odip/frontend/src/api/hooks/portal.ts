import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPostRaw, apiPut, apiDeleteRaw } from '../client'
import type {
  PortalShiftsResponseDto, PortalShiftDetailDto, PortalWitnessRequestDto, ShiftNoteDto, StartShiftDto, FinishShiftDto,
  EditShiftBreakDto, AcknowledgeHandoverDto, CreateAdministrationDto, AdministrationDto,
} from '../types'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { newCompletionRequestId } from '@/lib/completionRequestId'
import { offlineQueue, type NewRecord } from '@/lib/offline/queue'
import { readSaved, readSession, writeSaved } from '@/lib/offline/store'
import { applyQueued, applyQueuedList, applyQueuedNotes } from '@/lib/offline/overlay'
import { shiftLabel } from '@/lib/offline/label'

// ══════════════════════════════════════════════════════════════
// OFFLINE: the portal reads fall back to the copy saved on this phone, and the worker's writes go through the
// send-later queue (lib/offline/queue.ts). `networkMode: 'always'` on both: React Query's default pauses a request
// while the browser says it is offline and then resends it on reconnect, which would send outside the queue.
// ══════════════════════════════════════════════════════════════

/** The worker's own unsent changes, live: re-renders when one is queued, sent or discarded. */
export function useQueueRecords() {
  return useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getSnapshot)
}

/** When the saved copy under `part` was written (ms), or null. */
export function savedAtFor(part: string): number | null {
  const userId = readSession().userId
  return userId ? (readSaved(userId, part)?.savedAt ?? null) : null
}

function offlineQueryOptions<T>(queryKey: readonly unknown[], part: string | undefined, fetcher: () => Promise<T>) {
  const userId = readSession().userId
  const stored = () => (userId && part ? readSaved<T>(userId, part) : null)
  const first = stored()
  return {
    queryKey,
    networkMode: 'always' as const,
    initialData: first?.data,
    initialDataUpdatedAt: first?.savedAt,
    queryFn: async (): Promise<T> => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const s = stored()
        if (s) return s.data
      }
      try {
        const data = await fetcher()
        if (userId && part) writeSaved(userId, part, data)
        return data
      } catch (error) {
        const status = apiErrorStatus(error)
        if (status === undefined || status >= 500) {
          const s = stored()
          if (s) return s.data
        }
        throw error
      }
    },
  }
}

const detailQuery = (id: string) => offlineQueryOptions(['portal-shift-detail', id], `detail:${id}`, () => apiGet<PortalShiftDetailDto>(`/portal/shifts/${id}`))
const notesQuery = (id: string) => offlineQueryOptions(['portal-shift-notes', id], `notes:${id}`, () => apiGet<ShiftNoteDto[]>(`/portal/shifts/${id}/notes`))

/** Today's shifts, and any in progress, are saved in full as soon as the list loads, so they open with no signal. */
function useSaveTodaysShifts(data: PortalShiftsResponseDto | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!data) return
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: data.timeZoneId || undefined }).format(new Date())
    for (const s of data.shifts) {
      if (s.serviceDate.slice(0, 10) !== today && s.status !== 'InProgress') continue
      void qc.prefetchQuery({ ...detailQuery(s.id), staleTime: 60_000 })
      void qc.prefetchQuery({ ...notesQuery(s.id), staleTime: 60_000 })
    }
  }, [data, qc])
}

export function useMyShifts(from?: string, to?: string) {
  const records = useQueueRecords()
  const query = useQuery({
    ...offlineQueryOptions(['portal-my-shifts', from, to], `shifts:${from}:${to}`, () => apiGet<PortalShiftsResponseDto>('/portal/my-shifts', { from, to })),
    select: useCallback((d: PortalShiftsResponseDto) => applyQueuedList(d, records), [records]),
  })
  useSaveTodaysShifts(query.data)
  return query
}

export function usePortalShiftDetail(id: string | undefined) {
  const records = useQueueRecords()
  return useQuery({
    ...detailQuery(id ?? ''),
    enabled: !!id,
    select: useCallback((d: PortalShiftDetailDto) => applyQueued(d, records), [records]),
  })
}

// ══════════════════════════════════════════════════════════════
// SHIFT COMPLETION (design spec §2/§4) — Start/Finish on the worker's own shift.
// ══════════════════════════════════════════════════════════════

const detailOf = (qc: QueryClient, id: string) => qc.getQueryData<PortalShiftDetailDto>(['portal-shift-detail', id])

/**
 * Sends a shift write now, or keeps it on the phone to send later. A queued write resolves to `undefined` (nothing for the
 * screen to refresh: the unsent change is laid over the saved copy by lib/offline/overlay.ts); a sent one to the server's answer.
 */
function useQueuedWrite<TVars extends { id: string }, TData>(
  build: (vars: TVars, detail: PortalShiftDetailDto | undefined) => Omit<NewRecord, 'shiftId' | 'label'> & { routine?: string },
  onSent: (qc: QueryClient, data: TData, vars: TVars) => void,
) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (vars: TVars): Promise<TData | undefined> => {
      const detail = detailOf(qc, vars.id)
      const { routine, ...rec } = build(vars, detail)
      const out = await offlineQueue.sendOrQueue({ ...rec, shiftId: vars.id, label: shiftLabel(detail, routine) })
      return out.queued ? undefined : (out.data as TData)
    },
    onSuccess: (data, vars) => {
      if (data !== undefined) onSent(qc, data, vars)
    },
  })
}

const refreshShift = (qc: QueryClient, id: string) => {
  qc.invalidateQueries({ queryKey: ['portal-shift-detail', id] })
  qc.invalidateQueries({ queryKey: ['portal-shift-notes', id] })
  qc.invalidateQueries({ queryKey: ['portal-my-shifts'] })
}

/**
 * Invalidates the shift detail (status/completion flip to InProgress), the shift-notes cache
 * (harmless no-op here, kept only for symmetry with useFinishShift) and the my-shifts list (its
 * status chip needs to flip too) — same three-cache invalidation useFinishShift uses.
 * Queued while offline; the replay carries `startedAt` (the moment of the tap).
 */
export function useStartShift() {
  return useQueuedWrite<{ id: string; data: StartShiftDto }, PortalShiftDetailDto>(
    ({ id, data }) => ({ kind: 'start', path: `/portal/shifts/${id}/start`, method: 'POST', body: data, clientTimeField: 'startedAt' }),
    (qc, _, vars) => refreshShift(qc, vars.id),
  )
}

/** Queued while offline; the replay carries `finishedAt` (the moment of the tap) with every other field as entered. */
export function useFinishShift() {
  return useQueuedWrite<{ id: string; data: FinishShiftDto }, PortalShiftDetailDto>(
    ({ id, data }) => ({ kind: 'finish', path: `/portal/shifts/${id}/finish`, method: 'POST', body: data, clientTimeField: 'finishedAt' }),
    (qc, _, vars) => refreshShift(qc, vars.id),
  )
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

/** The server's answer replaces the cached detail in one step, then it refetches. A queued write leaves the cache to the overlay. */
const takeDetail = (qc: QueryClient, detail: PortalShiftDetailDto, vars: { id: string }) => {
  qc.setQueryData(['portal-shift-detail', vars.id], detail)
  qc.invalidateQueries({ queryKey: ['portal-shift-detail', vars.id] })
}

/**
 * POST portal/shifts/{id}/breaks/start — 409 SHIFT_BREAK_ALREADY_RUNNING if a break is already running. The break's id is made here and
 * rides the live send AND the replay (`breakId`), so a response lost on the way back cannot create a second break; the replay adds `startedAt`.
 */
export function useStartBreak() {
  return useQueuedWrite<{ id: string }, PortalShiftDetailDto>(
    ({ id }) => {
      const breakId = newCompletionRequestId()
      return { id: breakId, kind: 'breakStart', path: `/portal/shifts/${id}/breaks/start`, method: 'POST', body: { breakId }, clientTimeField: 'startedAt' }
    },
    takeDetail,
  )
}

/** POST portal/shifts/{id}/breaks/{breakId}/end — idempotent. The replay adds `endedAt`. */
export function useEndBreak() {
  return useQueuedWrite<{ id: string; breakId: string }, PortalShiftDetailDto>(
    ({ id, breakId }) => ({ kind: 'breakEnd', path: `/portal/shifts/${id}/breaks/${breakId}/end`, method: 'POST', body: undefined, clientTimeField: 'endedAt', target: breakId }),
    takeDetail,
  )
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
 * the first who and when, and it stays ticked if a coordinator edits the routine's time afterwards (a tick is found by routine, with the title and
 * occurrence time recorded on it). Replaces the cached shift detail with the response (`shiftRoutines[].isChecked` / `checkedAt` / `checkedByName`).
 */
export function useCheckRoutine() {
  return useQueuedWrite<{ id: string; routineId: string }, PortalShiftDetailDto>(
    ({ id, routineId }, detail) => ({ kind: 'tick', path: `/portal/shifts/${id}/routines/${routineId}/check`, method: 'POST', body: undefined, target: routineId, routine: detail?.routines?.find((r) => r.id === routineId)?.title }),
    takeDetail,
  )
}

/** DELETE portal/shifts/{id}/routines/{routineId}/check - untick a routine (the removal is audited). Idempotent; same scoping as `useCheckRoutine`. */
export function useUncheckRoutine() {
  return useQueuedWrite<{ id: string; routineId: string }, PortalShiftDetailDto>(
    ({ id, routineId }, detail) => ({ kind: 'untick', path: `/portal/shifts/${id}/routines/${routineId}/check`, method: 'DELETE', body: undefined, target: routineId, routine: detail?.routines?.find((r) => r.id === routineId)?.title }),
    takeDetail,
  )
}

/**
 * POST portal/shifts/{id}/handover/ack — the next worker marks the latest handover read (who and when are recorded). Pass the
 * `completionId` of the handover on screen so a newer one arriving meanwhile is 409 SHIFT_HANDOVER_CHANGED, not a silent ack. 404 SHIFT_HANDOVER_NOT_FOUND
 * when there is nothing to read, which includes a Published shift more than 48 hours before its rostered start (its handover is not shown yet: the
 * message says from when).
 */
export function useAcknowledgeHandover() {
  return useQueuedWrite<{ id: string; data?: AcknowledgeHandoverDto }, PortalShiftDetailDto>(
    ({ id, data }) => ({ kind: 'ack', path: `/portal/shifts/${id}/handover/ack`, method: 'POST', body: data ?? {} }),
    takeDetail,
  )
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
 * that record) and a not-given outcome never replaces another record. 409 ADMINISTRATION_SLOT_BUSY: another request held the slot's lock too
 * long (nothing written, no `data`): look at the dose, then try again. 422 ADMINISTRATION_TOO_EARLY: an Administered dose cannot be charted more than
 * 60 minutes before its slot (the message says from when); 422 ADMINISTRATION_TIME_OUT_OF_RANGE: `administeredAt` must lie between the earliest the
 * shift allows (the earlier of the start of any of its completions, including one archived by a coordinator Return, and an hour before the rostered
 * start) and now. A time up to 15 minutes AHEAD of the server is a device clock running fast: the dose is recorded with the server's now (the response
 * says what was stored); beyond 15 minutes it is the 422. A PRN dose's limits (maximum per 24 hours, minimum interval) are judged at `administeredAt`,
 * against the doses recorded on both sides of that time, so a 400 for a limit can name a dose recorded AFTER it (acknowledge with `acknowledgeLimitBreach`).
 * A retry of a dose must resend the SAME `administeredAt` (and dose and reasons) with the same `idempotencyKey`: for a PRN dose, which has no slot to
 * identify it, the key is honoured only when those match (10 minutes before the stored time or 15 after), else 400 ADMINISTRATION_IDEMPOTENCY_KEY_REUSED.
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
    // 409 ADMINISTRATION_ALREADY_RECORDED / SLOT_BUSY: someone else changed the slot, so the shift detail on screen is stale.
    onError: (_err, vars) => {
      qc.invalidateQueries({ queryKey: ['portal-shift-detail', vars.shiftId] })
    },
  })
}

// ══════════════════════════════════════════════════════════════
// SHIFT NOTES (NOTES-01)
// ══════════════════════════════════════════════════════════════

export function useShiftNotes(shiftId: string | undefined) {
  const records = useQueueRecords()
  return useQuery({
    ...notesQuery(shiftId ?? ''),
    enabled: !!shiftId,
    select: useCallback((d: ShiftNoteDto[]) => (shiftId ? applyQueuedNotes(d, records, shiftId) : d), [records, shiftId]),
  })
}

/**
 * The note's id and `createdAt` are made here and ride the live send AND the replay, so a response lost on the way back cannot make a second
 * note and the note keeps the time it was written. Queued while offline.
 */
export function useCreateShiftNote(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (body: string) => {
      const id = newCompletionRequestId()
      const detail = shiftId ? detailOf(qc, shiftId) : undefined
      const out = await offlineQueue.sendOrQueue({
        id, shiftId: shiftId ?? '', kind: 'note', path: `/portal/shifts/${shiftId}/notes`, method: 'POST',
        body: { id, createdAt: new Date().toISOString(), body }, label: shiftLabel(detail),
      })
      return out.queued ? undefined : (out.data as ShiftNoteDto)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-shift-notes', shiftId] }),
  })
}

/** A note still waiting to send is rewritten in place; editing one the server already has needs a connection (the screen says so). */
export function useUpdateShiftNote(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const queued = offlineQueue.getSnapshot().find((r) => r.id === id && r.kind === 'note' && r.status === 'waiting')
      if (queued) {
        offlineQueue.rewriteBody(id, { ...(queued.body as object), body })
        return undefined
      }
      return apiPut<ShiftNoteDto>(`/portal/notes/${id}`, { body })
    },
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
