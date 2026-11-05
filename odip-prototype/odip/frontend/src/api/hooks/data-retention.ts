import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { apiClient, apiGet, apiPost } from '../client'
import type { DataExportFailure, DataExportSaved, PurgeRecordDto, RetentionDueDto } from '../types'
import { extractErrorMessage } from '@/lib/utils'
import { exportFailure, saveZip } from './data-export'

export const RETENTION_DUE_KEY = ['data-retention', 'due'] as const
/** The one per-participant export mutation. The tab and the dialog read its state by this key, so only one runs at a time. */
export const PARTICIPANT_EXPORT_KEY = ['participant-export'] as const

// The server's sentences (DataRetentionController), matched to tell the two 400s and the two 409s apart.
const NAME_MISMATCH = "The last name doesn't match."
const REASON_REQUIRED = 'Give a reason for the purge.'
const NOT_DUE = "This record isn't due for purge."

const GONE: DataExportFailure = { title: 'That record is no longer here', body: 'It may already have been purged. The list is refreshed.', retry: false }
const DOWNLOAD_DIDNT_FINISH: DataExportFailure = {
  title: "The download didn't finish",
  body: 'The download stopped before the file was complete, so nothing was saved. Try again.',
  retry: true,
}

/** GET /data-retention/due: archived participants past their 7 years, oldest first. */
export function useRetentionDue() {
  return useQuery({ queryKey: RETENTION_DUE_KEY, queryFn: () => apiGet<RetentionDueDto[]>('/data-retention/due') })
}

/** The words for a failed per-participant download: 404 means the record has gone, 429 is the data export's own answer. */
export async function participantExportFailure(err: unknown): Promise<DataExportFailure> {
  const status = isAxiosError(err) ? err.response?.status : undefined
  if (status === 404) return GONE
  if (status === 429) return exportFailure(err)
  return DOWNLOAD_DIDNT_FINISH
}

/**
 * GET /data-export/participants/{id}: one participant's rows as a ZIP, saved as the full export is.
 * A 404 also refetches the due list, because the row has gone.
 */
export function useParticipantExport() {
  const queryClient = useQueryClient()
  return useMutation<DataExportSaved, DataExportFailure, { participantId: string }>({
    mutationKey: PARTICIPANT_EXPORT_KEY,
    mutationFn: async ({ participantId }) => {
      let response
      try {
        response = await apiClient.get<Blob>(`/data-export/participants/${participantId}`, { responseType: 'blob' })
      } catch (err) {
        if (isAxiosError(err) && err.response?.status === 404) void queryClient.invalidateQueries({ queryKey: RETENTION_DUE_KEY })
        throw await participantExportFailure(err)
      }
      return saveZip(response)
    },
  })
}

/** POST /data-retention/{id}/purge. The row leaves the cached list at once; the list and the Tasks page are then refetched. */
export function usePurgeParticipant() {
  const queryClient = useQueryClient()
  return useMutation<PurgeRecordDto, unknown, { participantId: string; lastName: string; reason: string }>({
    mutationFn: ({ participantId, lastName, reason }) => apiPost<PurgeRecordDto>(`/data-retention/${participantId}/purge`, { lastName, reason }),
    onSuccess: (_record, { participantId }) => {
      queryClient.setQueryData<RetentionDueDto[]>(RETENTION_DUE_KEY, (rows) => rows?.filter((r) => r.participantId !== participantId))
      void queryClient.invalidateQueries({ queryKey: RETENTION_DUE_KEY })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export interface PurgeFailure {
  message: string
  /** The list is out of date: refetch it. */
  refresh: boolean
  /** The same request can never work: hold the confirm button disabled. */
  final: boolean
  /** Which field the sentence belongs under, when it is about one. */
  field?: 'lastName' | 'reason'
}

/** The dialog's words for a failed purge (SHAPE section 3.4, item 7). */
export function purgeFailure(err: unknown): PurgeFailure {
  const response = isAxiosError(err) ? err.response : undefined
  if (!response) return { message: "Couldn't confirm the purge. Check the list before trying again.", refresh: true, final: false }
  const sentence = extractErrorMessage(err, '')
  if (response.status === 404) return { message: 'This record is no longer here. It may already have been purged.', refresh: true, final: true }
  if (response.status === 409 && sentence === NOT_DUE) {
    return { message: `${NOT_DUE} It may have been restored or have newer activity, so its 7 years start again. The list is refreshed.`, refresh: true, final: true }
  }
  if (response.status === 400 && sentence === NAME_MISMATCH) return { message: NAME_MISMATCH, refresh: false, final: false, field: 'lastName' }
  if (response.status === 400 && sentence === REASON_REQUIRED) return { message: REASON_REQUIRED, refresh: false, final: false, field: 'reason' }
  return { message: sentence || "The purge couldn't finish. Nothing was deleted. Try again.", refresh: false, final: false }
}
