import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import DataExportTab from './DataExportTab'
import { formatDateTimeAu } from '@/lib/format'

const { get, getWithDefault } = vi.hoisted(() => ({ get: vi.fn(), getWithDefault: vi.fn() }))
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiGetWithDefault: getWithDefault, apiClient: Object.assign(Object.create(actual.apiClient), { get }) }
})

type Progress = (e: { loaded: number }) => void
const never = () => new Promise<never>(() => {})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}
// 2 KB ending in the end-of-central-directory record (PK 05 06 and 18 bytes), as a ZIP the server finished does.
const wholeZip = () => { const bytes = new Uint8Array(2048); bytes.set([0x50, 0x4b, 0x05, 0x06], 2048 - 22); return bytes }
const zipResponse = { data: new Blob([wholeZip()]), headers: { 'content-disposition': 'attachment; filename="odip-export-sunrise-care-2026-10-14.zip"' } }
const jordan = { exportedAt: '2026-10-14T05:04:00Z', exportedByName: 'Jordan Lee' }
let saved: string[] = []

const renderTab = (client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => ({
  client,
  ...render(<QueryClientProvider client={client}><DataExportTab /></QueryClientProvider>),
})
const downloadButton = () => screen.getByRole('button', { name: /^(Download all data|Preparing export…|Downloading…)$/ })

beforeEach(() => {
  saved = []
  getWithDefault.mockResolvedValue(null)
  window.URL.createObjectURL = vi.fn(() => 'blob:export')
  window.URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); get.mockReset(); getWithDefault.mockReset() })

describe('DataExportTab', () => {
  it('says nothing about the last export until the answer is in, then "Not exported yet."', async () => {
    const answer = deferred<null>()
    getWithDefault.mockReturnValue(answer.promise)
    renderTab()
    expect(getWithDefault).toHaveBeenCalledWith('/data-export/last', null)
    expect(screen.queryByText('Not exported yet.')).toBeNull()
    answer.resolve(null)
    expect(await screen.findByText('Not exported yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Export all your data' })).toBeInTheDocument()
  })

  it('names who exported last and when', async () => {
    getWithDefault.mockResolvedValue(jordan)
    renderTab()
    expect(await screen.findByText(`Last exported by Jordan Lee on ${formatDateTimeAu(jordan.exportedAt)}`)).toBeInTheDocument()
  })

  it("says it couldn't check the last export, and the button still works", async () => {
    getWithDefault.mockRejectedValue(new Error('down'))
    get.mockReturnValue(never())
    renderTab()
    expect(await screen.findByText("Couldn't check the last export.")).toBeInTheDocument()
    await userEvent.click(downloadButton())
    expect(get).toHaveBeenCalledWith('/data-export', expect.objectContaining({ responseType: 'blob' }))
  })

  it('while preparing, the button keeps focus, is busy and aria-disabled but not disabled, and a second click starts nothing', async () => {
    get.mockReturnValue(never())
    renderTab()
    const user = userEvent.setup()
    await user.click(downloadButton())
    const button = await screen.findByRole('button', { name: 'Preparing export…' })
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(screen.getByText('Building your export. This can take a few minutes for a large organisation.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Export started. This can take a few minutes.')
    await user.click(button)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('shows the bytes received so far, never a percentage', async () => {
    let progress: Progress | undefined
    get.mockImplementation((_url: string, config: { onDownloadProgress: Progress }) => { progress = config.onDownloadProgress; return never() })
    renderTab()
    await userEvent.click(downloadButton())
    act(() => progress!({ loaded: 13_002_342 }))
    expect(await screen.findByText("Downloading… 12.4 MB so far. Keep this page open until it's saved.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Downloading…' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('%')
  })

  it("saves the file under the server's name, says so, and refetches the last-export line", async () => {
    get.mockResolvedValue(zipResponse)
    renderTab()
    await screen.findByText('Not exported yet.')
    getWithDefault.mockResolvedValue(jordan)
    await userEvent.click(downloadButton())
    expect(await screen.findByText('Export saved')).toBeInTheDocument()
    expect(screen.getByText('Saved as odip-export-sunrise-care-2026-10-14.zip (2 KB). Your browser lists it in its downloads.')).toBeInTheDocument()
    expect(saved).toEqual(['odip-export-sunrise-care-2026-10-14.zip'])
    expect(screen.getByRole('status')).toHaveTextContent('Export saved.')
    expect(await screen.findByText(/^Last exported by Jordan Lee on /)).toBeInTheDocument()
    expect(getWithDefault).toHaveBeenCalledTimes(2)
  })

  it("a broken stream says it didn't finish, leaves the last-export line alone, and Try again starts a new download", async () => {
    get.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK')).mockReturnValueOnce(never())
    renderTab()
    await screen.findByText('Not exported yet.')
    await userEvent.click(downloadButton())
    expect(await screen.findByText("The export didn't finish")).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent("The export didn't finish. The download stopped before the file was complete, so nothing was saved. Try again.")
    expect(screen.getByText('Not exported yet.')).toBeInTheDocument()
    expect(getWithDefault).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("a body cut off before the end of the ZIP is never saved, and says it didn't finish", async () => {
    get.mockResolvedValue({ ...zipResponse, data: new Blob([wholeZip().slice(0, 1024)]) })
    renderTab()
    await userEvent.click(downloadButton())
    expect(await screen.findByText("The export didn't finish")).toBeInTheDocument()
    expect(saved).toEqual([])
  })

  it("a 400 shows the server's own sentence, read out of the Blob body", async () => {
    const data = new Blob([JSON.stringify({ success: false, errors: ['Choose an organisation to view as before exporting data.'] })])
    get.mockRejectedValue(new AxiosError('Bad', 'ERR_BAD_REQUEST', undefined, undefined, { status: 400, statusText: '', data, headers: {}, config: { headers: new AxiosHeaders() } } as AxiosResponse))
    renderTab()
    await userEvent.click(downloadButton())
    expect(await screen.findByText('Choose an organisation first')).toBeInTheDocument()
    expect(screen.getByText('Choose an organisation to view as before exporting data.')).toBeInTheDocument()
  })

  it.each([
    [403, "You can't export this organisation's data"],
    [404, 'That organisation no longer exists'],
  ])('a %i offers no Try again, since the same request would fail the same way', async (status, title) => {
    get.mockRejectedValue(new AxiosError('No', 'ERR_BAD_REQUEST', undefined, undefined, { status, statusText: '', data: new Blob(['{}']), headers: {}, config: { headers: new AxiosHeaders() } } as AxiosResponse))
    renderTab()
    await userEvent.click(downloadButton())
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('a tab switch loses nothing: coming back shows the download still running, then its outcome', async () => {
    const response = deferred<typeof zipResponse>()
    get.mockReturnValue(response.promise)
    const { client, unmount } = renderTab()
    await userEvent.click(downloadButton())
    await screen.findByRole('button', { name: 'Preparing export…' })
    unmount()

    renderTab(client)
    expect(await screen.findByRole('button', { name: 'Downloading…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText("Still downloading. Keep this page open until it's saved.")).toBeInTheDocument()
    await act(async () => response.resolve(zipResponse))
    expect(await screen.findByText('Export saved')).toBeInTheDocument()
    expect(saved).toEqual(['odip-export-sunrise-care-2026-10-14.zip'])
  })
})
