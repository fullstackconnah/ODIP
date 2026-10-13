import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPost } from '../client'
import type { ImportBatchDto, ImportInviteDto, ImportKind, ImportLanding, ImportPreviewDto, ImportResultDto } from '../types'

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

/** The lists an import or an undo changes. */
function refreshAfterImport(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['imports', 'participants', 'staff']) qc.invalidateQueries({ queryKey: [key] })
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

/** POST /imports/{id}/invites: makes sure each never-signed-in staff member of the batch has a sign-in account. The browser sends the emails. */
export function useImportInvites() {
  return useMutation({ mutationFn: (batchId: string) => apiPost<ImportInviteDto[]>(`/imports/${batchId}/invites`) })
}

/** GET /imports/{kind}/template, saved under the name the server gives it. */
export function useDownloadImportTemplate() {
  return useMutation({
    mutationFn: async (kind: ImportKind) => {
      const response = await apiClient.get<Blob>(`/imports/${kind}/template`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `odip-${kind}-template.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    },
  })
}
