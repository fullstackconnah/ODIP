import { isAxiosError } from 'axios'
import { apiClient } from '@/api/client'
import { serverSentence } from '@/api/hooks/data-export'

/**
 * GETs a file and saves it as `filename`. A refusal throws an Error carrying the server's sentence, or `fallback`: the request asks for a Blob,
 * so a refused one's JSON arrives as a Blob too and is read before its message can be shown.
 */
export async function downloadFile(url: string, filename: string, fallback = "Couldn't download the file. Try again."): Promise<void> {
  let data: Blob
  try {
    data = (await apiClient.get<Blob>(url, { responseType: 'blob' })).data
  } catch (err) {
    throw new Error(await serverSentence(isAxiosError(err) ? err.response?.data : undefined, fallback))
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([data]))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
