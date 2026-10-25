import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { WhatsNewEntry, WhatsNewFeed } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import WhatsNewButton from './WhatsNewButton'

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPost: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet: mockApiGet, apiPost: mockApiPost }))

const important = (n: number): WhatsNewEntry => ({
  id: `i${n}`, title: `Important ${n}`, body: `Body ${n}`, important: true, publishedAtUtc: `2026-10-${String(25 - n).padStart(2, '0')}T01:00:00Z`,
})
const feedOf = (popup: WhatsNewEntry[]): WhatsNewFeed => ({ entries: popup, unreadCount: popup.length, popup })

let qc: QueryClient
let server: WhatsNewFeed

beforeEach(() => {
  server = feedOf([important(1)])
  mockApiGet.mockReset()
  mockApiPost.mockReset()
  mockApiGet.mockImplementation(async () => server)
  mockApiPost.mockResolvedValue(true)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

function desktop() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

/** The button with a ConfirmDialog beside it that a test can open: another layer the pop-up must wait for. */
function Page() {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <WhatsNewButton />
      <button type="button" onClick={() => setConfirming(true)}>Ask</button>
      <ConfirmDialog open={confirming} onCancel={() => setConfirming(false)} onConfirm={() => setConfirming(false)} title="Sure?" message="Really?" />
    </>
  )
}

function renderPage() {
  desktop()
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Page /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const popupDialog = () => screen.queryByRole('dialog', { name: "What's new" })
const popupSeenCalls = () => mockApiPost.mock.calls.filter(([url]) => url === '/whats-new/popup-seen')
const panelHeading = () => screen.queryByRole('heading', { level: 2, name: "What's new" })

describe('WhatsNewPopup', () => {
  it('V-P1: an empty popup list shows no dialog; one important entry shows the dialog with its title', async () => {
    server = feedOf([])
    const { unmount } = renderPage()
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled())
    await act(async () => {})
    expect(popupDialog()).toBeNull()
    unmount()

    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    server = feedOf([important(1)])
    renderPage()
    const dialog = await screen.findByRole('dialog', { name: "What's new" })
    expect(within(dialog).getByText('Important 1')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'See all' })).toBeNull()
    expect(dialog.textContent).not.toMatch(/ODIP/i)
    // Portalled out of the header: its backdrop-blur would clip the fixed overlay to the 48px bar.
    expect(screen.getByRole('button', { name: /What's new$/ }).parentElement?.contains(dialog)).toBe(false)
  })

  it.each([
    ['Got it', () => fireEvent.click(screen.getByRole('button', { name: 'Got it' }))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['the backdrop', () => fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)],
  ])('V-P2: %s closes it and posts popup-seen exactly once', async (_name, dismiss) => {
    renderPage()
    await screen.findByRole('dialog', { name: "What's new" })
    dismiss()

    await waitFor(() => expect(popupDialog()).toBeNull())
    await waitFor(() => expect(popupSeenCalls()).toHaveLength(1))
    await act(async () => {})
    expect(popupSeenCalls()).toHaveLength(1)
  })

  it('V-P2: closing returns focus to the What\'s new button', async () => {
    renderPage()
    await screen.findByRole('dialog', { name: "What's new" })
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /What's new$/ })).toHaveFocus())
  })

  it('V-P3: five entries show three, say so, and "See all" closes it, posts popup-seen, then opens the panel with its heading focused', async () => {
    server = feedOf([1, 2, 3, 4, 5].map(important))
    renderPage()
    const dialog = await screen.findByRole('dialog', { name: "What's new" })
    expect(within(dialog).getAllByRole('article')).toHaveLength(3)
    expect(within(dialog).getByText('Showing 3 of 5 important updates.')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'See all' }))
    await waitFor(() => expect(panelHeading()).toHaveFocus())
    expect(popupDialog()).toBeNull()
    await waitFor(() => expect(popupSeenCalls()).toHaveLength(1))
  })

  it('V-P4: waits for another dialog to close, then appears', async () => {
    renderPage()
    // Open the confirm dialog before the feed answers, so the pop-up finds a layer already open.
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByRole('alertdialog', { name: 'Sure?' })
    await act(async () => {})
    expect(popupDialog()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('dialog', { name: "What's new" })).toBeInTheDocument()
  })

  it('V-P5: a panel opened first means no pop-up, and popup-seen is posted', async () => {
    renderPage()
    // The button is there before the feed answers; opening the panel at once is "reading the full list already".
    fireEvent.click(screen.getByRole('button', { name: /What's new$/ }))
    await screen.findByText('Important 1')
    await act(async () => {})

    expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull()
    await waitFor(() => expect(popupSeenCalls()).toHaveLength(1))
  })

  it('V-P6: a refetch that empties the list while it is open does not close it', async () => {
    renderPage()
    await screen.findByRole('dialog', { name: "What's new" })
    server = feedOf([])
    await act(async () => { await qc.invalidateQueries({ queryKey: ['whats-new'] }) })
    expect(popupDialog()).toBeInTheDocument()
  })

  it('V-P7: after "Got it", a refetch that still returns the same entries opens nothing', async () => {
    renderPage()
    await screen.findByRole('dialog', { name: "What's new" })
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(popupDialog()).toBeNull())

    server = feedOf([important(1)])
    await act(async () => { await qc.invalidateQueries({ queryKey: ['whats-new'] }) })
    expect(popupDialog()).toBeNull()
  })

  it('V-P8: when the first answer has no popup entries, a later refetch with one opens nothing', async () => {
    server = feedOf([])
    renderPage()
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled())
    await act(async () => {})

    server = feedOf([important(1)])
    await act(async () => { await qc.invalidateQueries({ queryKey: ['whats-new'] }) })
    expect(popupDialog()).toBeNull()
  })

  it('V-P9: the pop-up never says ODIP, with one entry or five', async () => {
    server = feedOf([1, 2, 3, 4, 5].map(important))
    renderPage()
    const dialog = await screen.findByRole('dialog', { name: "What's new" })
    expect(dialog.textContent).not.toMatch(/ODIP/i)
  })
})
