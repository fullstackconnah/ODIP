import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPost } from '../client'
import { refreshBudgetWarnings } from './funding-ledger'
import type { ImportBatchDto, ImportInvitesDto, ImportKind, ImportLanding, ImportPreviewDto, ImportResultDto } from '../types'

const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } }

/** The form every import call sends: the file, and the column matches once the person has seen them. */
function importForm(file: File, mapping?: (string | null)[], extra: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.append('file', file)
  if (mapping) form.append('mapping', JSON.stringify(mapping))
  for (const [key, value] of Object.entries(extra)) form.append(key, value)
  return form
}

/** GET /imports: this organisation's import batches, newest first. */
export function useImportHistory(enabled = true) {
  return useQuery({ queryKey: ['imports'], queryFn: () => apiGet<ImportBatchDto[]>('/imports'), enabled })
}

/** POST /imports/{kind}/preview: what each row of the file would do. Writes nothing. */
export function usePreviewImport() {
  return useMutation({
    mutationFn: ({ kind, file, mapping }: { kind: ImportKind; file: File; mapping?: (string | null)[] }) =>
      apiPost<ImportPreviewDto>(`/imports/${kind}/preview`, importForm(file, mapping), MULTIPART),
  })
}

/** The lists an import or an undo changes. A funding plans import also changes each participant's Funding tab, the onboarding "Funding recorded" gate and the Budgets list. */
function refreshAfterImport(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['imports', 'participants', 'staff', 'participant-funding', 'onboarding', 'participant-onboarding-worklist', 'dashboard']) qc.invalidateQueries({ queryKey: [key] })
  refreshBudgetWarnings(qc)
}

/** POST /imports/{kind}/commit. A retry with the same idempotency key answers with the batch the first request made. */
export function useCommitImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, file, mapping, landing, idempotencyKey }: { kind: ImportKind; file: File; mapping: (string | null)[]; landing?: ImportLanding; idempotencyKey: string }) =>
      apiPost<ImportResultDto>(`/imports/${kind}/commit`, importForm(file, mapping, { idempotencyKey, ...(landing ? { landing } : {}) }), MULTIPART),
    onSuccess: () => refreshAfterImport(qc),
  })
}

/** POST /imports/{id}/undo. A 409 carries the records that changed since the import in `data` (see undoBlockers in ImportDataTab). */
export function useUndoImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (batchId: string) => apiPost<ImportBatchDto>(`/imports/${batchId}/undo`),
    onSuccess: () => refreshAfterImport(qc),
  })
}

/**
 * POST /imports/{id}/invites: makes sure the batch's never-signed-in staff have sign-in accounts, up to 100 per call after the cursor `after`
 * (the previous call's `next`), and says how many are left. The browser sends the emails.
 */
export function useImportInvites() {
  return useMutation({
    mutationFn: ({ batchId, after }: { batchId: string; after?: string }) =>
      apiPost<ImportInvitesDto>(`/imports/${batchId}/invites${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  })
}

/** GET /imports/{kind}/template, saved under the name the server gives it. */
export function useDownloadImportTemplate() {
  return useMutation({
    mutationFn: async (kind: ImportKind) => {
      const response = await apiClient.get<Blob>(`/imports/${kind}/template`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `bunya-support-${kind}-template.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    },
  })
}
