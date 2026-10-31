import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useDownloadWeeklySchedulePdf } from './rostering'

const { loaded, generate, toWeek, apiGet, settings } = vi.hoisted(() => ({
  loaded: vi.fn(), generate: vi.fn(), toWeek: vi.fn(), apiGet: vi.fn(), settings: vi.fn(),
}))
const MODEL = { participantName: 'Liam Okafor' }

vi.mock('../client', async importOriginal => ({ ...(await importOriginal<typeof import('../client')>()), apiGet, apiGetWithDefault: settings }))
// The factory runs when the module is first imported, so `loaded` shows when react-pdf is pulled in.
vi.mock('@/components/ScheduleWeekPdf', () => { loaded(); return { toScheduleWeek: toWeek, generateScheduleWeekPdf: generate } })

function setup(name: string | undefined = 'Liam Okafor', week: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useDownloadWeeklySchedulePdf(name, week), { wrapper })
}
const VARS = { id: 'p-0001', fileName: 'Liam Okafor - Weekly Schedule' }

beforeEach(() => {
  vi.clearAllMocks()
  apiGet.mockResolvedValue({ groupBy: 'Participant', weekStart: '2026-09-07', days: [], participantRows: [] })
  settings.mockResolvedValue({ organisationName: 'Synthetic Support' })
  toWeek.mockReturnValue(MODEL)
  generate.mockResolvedValue(undefined)
})

describe('useDownloadWeeklySchedulePdf', () => {
  it('loads the PDF library on the click, not with the hook', async () => {
    const { result } = setup()
    expect(loaded).not.toHaveBeenCalled()
    await result.current.mutateAsync(VARS)
    expect(loaded).toHaveBeenCalledTimes(1)
  })

  it('asks for the server current week when no week is chosen, and for the chosen one otherwise', async () => {
    const a = setup()
    await a.result.current.mutateAsync(VARS)
    expect(apiGet).toHaveBeenLastCalledWith('/rostering/board', { groupBy: 'participant', participantId: 'p-0001' })
    const b = setup('Liam Okafor', '2026-09-14')
    await b.result.current.mutateAsync(VARS)
    expect(apiGet).toHaveBeenLastCalledWith('/rostering/board', { groupBy: 'participant', participantId: 'p-0001', weekStart: '2026-09-14' })
  })

  it('names the file after the week the server answered with', async () => {
    const { result } = setup()
    await result.current.mutateAsync(VARS)
    expect(generate).toHaveBeenCalledWith(MODEL, 'Liam Okafor - Weekly Schedule 2026-09-07.pdf')
    expect(generate.mock.calls[0][1]).toMatch(/^.+ - Weekly Schedule \d{4}-\d{2}-\d{2}\.pdf$/)
  })

  it('passes the trimmed organisation name, or null when there are no settings', async () => {
    settings.mockResolvedValue({ organisationName: '  Synthetic Support ' })
    await setup().result.current.mutateAsync(VARS)
    expect(toWeek).toHaveBeenLastCalledWith(expect.anything(), 'p-0001', 'Liam Okafor', 'Synthetic Support')
    settings.mockResolvedValue(null)
    await setup().result.current.mutateAsync(VARS)
    expect(toWeek).toHaveBeenLastCalledWith(expect.anything(), 'p-0001', 'Liam Okafor', null)
  })

  it('still makes the PDF, without the organisation line, when the settings cannot be read', async () => {
    settings.mockRejectedValue(new Error('403'))
    await setup().result.current.mutateAsync(VARS)
    expect(toWeek).toHaveBeenLastCalledWith(expect.anything(), 'p-0001', 'Liam Okafor', null)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('fails without a download when the board cannot be read', async () => {
    apiGet.mockRejectedValue(new Error('500'))
    const { result } = setup()
    result.current.mutate(VARS)
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(generate).not.toHaveBeenCalled()
  })
})
