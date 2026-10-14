import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { apiClient, apiGetWithDefault } from '../client'
import type { DataExportFailure, DataExportLastDto, DataExportSaved } from '../types'
import { extractErrorMessage } from '@/lib/utils'
import { localIsoDate } from '@/lib/dateOnly'

/** The one export mutation. The tab reads its state by this key, so leaving the tab and coming back doesn't lose a running download. */
export const DATA_EXPORT_KEY = ['data-export'] as const
const LAST_KEY = ['data-export', 'last'] as const
const NO_ORGANISATION = 'Choose an organisation to view as before exporting data.'
const DIDNT_FINISH: DataExportFailure = {
  title: "The export didn't finish",
  body: 'The download stopped before the file was complete, so nothing was saved. Try again.',
}

/** GET /data-export/last. The API leaves `data` out when nothing has been exported yet: that is null here, never undefined. */
export function useDataExportLast() {
  return useQuery({
    queryKey: LAST_KEY,
    queryFn: () => apiGetWithDefault<DataExportLastDto | null>('/data-export/last', null),
  })
}

/**
 * GET /data-export: the whole organisation as one ZIP.
 * - The mutation saves the file itself (as useDownloadImportTemplate does) and refetches the last-export line, so both happen even if the tab
 *   has gone.
 * - `onProgress` gets the bytes received so far. A streamed ZIP has no length, so there is no percentage.
 */
export function useDataExport() {
  const queryClient = useQueryClient()
  return useMutation<DataExportSaved, DataExportFailure, { onProgress?: (bytes: number) => void }>({
    mutationKey: DATA_EXPORT_KEY,
    mutationFn: async ({ onProgress }) => {
      let response
      try {
        // shortcut: the whole ZIP is held in browser memory; move to a one-time signed link if a real export passes a few hundred MB.
        response = await apiClient.get<Blob>('/data-export', { responseType: 'blob', onDownloadProgress: (e) => onProgress?.(e.loaded) })
      } catch (err) {
        throw await exportFailure(err)
      }
      // The server resets the connection on a failure, but a proxy could still end a cut-off body cleanly: never save that as whole.
      if (!(await isWholeZip(response.data))) throw DIDNT_FINISH
      const fileName = exportFileName(response.headers['content-disposition'])
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      return { fileName, bytes: response.data.size }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LAST_KEY }),
  })
}

/** The server's name for the file (odip-export-<organisation>-<date>.zip), or one with today's date when the header can't be read. */
export function exportFileName(contentDisposition: unknown): string {
  const match = typeof contentDisposition === 'string' ? /filename="?([^";]+)"?/i.exec(contentDisposition) : null
  return match?.[1] ?? `odip-export-${localIsoDate()}.zip`
}

/** The tab's words for a failed download (SHAPE section 3). */
export async function exportFailure(err: unknown): Promise<DataExportFailure> {
  const response = isAxiosError(err) ? err.response : undefined
  if (isAxiosError(err) && !response) return DIDNT_FINISH
  if (response?.status === 400) {
    // A blob request's error body is itself a Blob, so read the ApiResponse out of it first.
    let data: unknown = response.data
    try {
      data = data instanceof Blob ? JSON.parse(await readText(data)) : data
    } catch {
      data = undefined
    }
    return { title: 'Choose an organisation first', body: extractErrorMessage({ response: { data } }, NO_ORGANISATION) }
  }
  if (response?.status === 403) return { title: "You can't export this organisation's data", body: 'Only an Admin can download a full export.' }
  // A SuperAdmin viewing an organisation that has gone (DataExportController's 404): trying again never helps.
  if (response?.status === 404) return { title: 'That organisation no longer exists', body: 'Choose another organisation to view as.' }
  return { title: "The export couldn't be built", body: 'Try again in a few minutes. Nothing was saved.' }
}

/**
 * A ZIP the server finished ends with its end-of-central-directory record: PK 05 06, then 18 bytes, as .NET writes it last with no comment.
 * A body cut off part-way doesn't.
 */
export async function isWholeZip(blob: Blob): Promise<boolean> {
  if (blob.size < 22) return false
  const tail = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader() // not Blob.arrayBuffer(): jsdom has none
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob.slice(blob.size - 22))
  })
  const [p, k, five, six] = new Uint8Array(tail)
  return p === 0x50 && k === 0x4b && five === 0x05 && six === 0x06
}

/** FileReader, not Blob.text(): jsdom, which the tests run in, has no Blob.text(). */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}
