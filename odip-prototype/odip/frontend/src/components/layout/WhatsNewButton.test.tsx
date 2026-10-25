import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import type { WhatsNewEntry, WhatsNewFeed } from '@/api/types'
import WhatsNewButton from './WhatsNewButton'

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPost: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet: mockApiGet, apiPost: mockApiPost }))

const entry = (n: number, over: Partial<WhatsNewEntry> = {}): WhatsNewEntry => ({
  id: `e${n}`, title: `Entry ${n}`, body: `Body ${n}`, important: false, publishedAtUtc: `2026-10-${String(25 - n).padStart(2, '0')}T01:00:00Z`, ...over,
})
const feed = (entries: WhatsNewEntry[], unreadCount = 0): WhatsNewFeed => ({ entries, unreadCount, popup: [] })

let server: WhatsNewFeed

beforeEach(() => {
  server = feed([entry(1), entry(2), entry(3)], 2)
  mockApiGet.mockReset()
  mockApiPost.mockReset()
  mockApiGet.mockImplementation(async () => server)
  mockApiPost.mockImplementation(async (url: string) => {
    if (url === '/whats-new/seen') server = { ...server, unreadCount: 0 }
    return true
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

/** From lg: matchMedia for `(min-width: 64rem)`. Without it (jsdom has none), useIsBelowLg assumes a phone. */
function desktop() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/trips']}>
        <Routes>
          <Route path="*" element={<><WhatsNewButton /><button type="button">Elsewhere</button><p>Plain text</p><Link to="/staff">Go to staff</Link></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const button = () => screen.getByRole('button', { name: /What's new$/ })
const ready = () => screen.findByRole('button', { name: '2 unread, What\'s new' })
const heading = () => screen.queryByRole('heading', { level: 2, name: "What's new" })
const seenCalls = () => mockApiPost.mock.calls.filter(([url]) => url === '/whats-new/seen')

describe('WhatsNewButton: the button (V-B1, V-B2)', () => {
  it('is named "What\'s new" with nothing unread and "2 unread, What\'s new" with two; the dot is decorative and only there while unread', async () => {
    renderButton()
    expect(button()).toHaveAccessibleName("What's new")
    expect(button()).toHaveAttribute('title', "What's new")
    expect(button()).toHaveTextContent(/^campaign$/)
    expect(button().querySelector('[aria-hidden="true"].rounded-full')).toBeNull()

    await ready()
    expect(button().querySelector('span.rounded-full')).toHaveAttribute('aria-hidden', 'true')
  })

  it('opening marks everything seen once and clears the name at once; with nothing unread it posts nothing', async () => {
    desktop()
    renderButton()
    fireEvent.click(await ready())

    await waitFor(() => expect(button()).toHaveAccessibleName("What's new"))
    await waitFor(() => expect(seenCalls()).toHaveLength(1))
    fireEvent.click(button())
    fireEvent.click(button())
    expect(seenCalls()).toHaveLength(1)
  })
})

describe('WhatsNewButton: the panel (V-B3, V-B4)', () => {
  it('from lg is a popover whose heading takes focus', async () => {
    desktop()
    renderButton()
    fireEvent.click(await ready())

    expect(heading()).toHaveFocus()
    expect(button()).toHaveAttribute('aria-expanded', 'true')
    expect(button()).toHaveAttribute('aria-controls')
    expect(button()).not.toHaveAttribute('aria-haspopup')
  })

  it('below lg is the SlideOver, portalled to the body', async () => {
    renderButton()
    fireEvent.click(await ready())

    const dialog = await screen.findByRole('dialog', { name: "What's new" })
    expect(document.body.contains(dialog)).toBe(true)
    expect(button().parentElement?.contains(dialog)).toBe(false)
    expect(button()).toHaveAttribute('aria-haspopup', 'dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement) && document.activeElement?.textContent === "What's new").toBe(true))
  })

  it('Escape, a click outside, focus moving on and a route change close it; Escape and an outside click return focus to the button', async () => {
    desktop()
    renderButton()
    fireEvent.click(await ready())
    expect(heading()).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(heading()).not.toBeInTheDocument()
    expect(button()).toHaveFocus()

    fireEvent.click(button())
    fireEvent.mouseDown(screen.getByText('Plain text'))
    expect(heading()).not.toBeInTheDocument()
    await waitFor(() => expect(button()).toHaveFocus())

    fireEvent.click(button())
    fireEvent.blur(screen.getByRole('heading', { level: 2 }), { relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }) })
    expect(heading()).not.toBeInTheDocument()

    fireEvent.click(button())
    fireEvent.click(screen.getByRole('link', { name: 'Go to staff' }))
    expect(heading()).not.toBeInTheDocument()
  })
})

describe('WhatsNewButton: the entries (V-B5, V-B6, V-B8)', () => {
  it('labels the first unreadCount entries "New" for that open only', async () => {
    desktop()
    renderButton()
    fireEvent.click(await ready())

    const articles = screen.getAllByRole('article')
    expect(articles).toHaveLength(3)
    expect(within(articles[0]).getByText('New')).toBeInTheDocument()
    expect(within(articles[1]).getByText('New')).toBeInTheDocument()
    expect(within(articles[2]).queryByText('New')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(button()).toHaveAccessibleName("What's new"))
    fireEvent.click(button())
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.queryByText('New')).toBeNull()
  })

  it('draws a blank line as a new paragraph, keeps a single line break, and shows markup as text', async () => {
    server = feed([entry(1, { body: 'A\n\nB\nC <b>x</b>' })])
    desktop()
    renderButton()
    fireEvent.click(button())

    const paragraphs = await screen.findAllByText(/^(A|B)/)
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1].textContent).toBe('B\nC <b>x</b>')
    expect(paragraphs[1]).toHaveClass('whitespace-pre-line')
    expect(paragraphs[1].querySelector('b')).toBeNull()
  })

  it('shows the date in Sydney time: 24 Oct 14:00 UTC is 25 Oct there', async () => {
    server = feed([entry(1, { publishedAtUtc: '2026-10-24T14:00:00Z' })])
    desktop()
    renderButton()
    fireEvent.click(button())

    const time = await screen.findByText('25 Oct 2026')
    expect(time).toHaveAttribute('datetime', '2026-10-24T14:00:00Z')
  })
})

describe('WhatsNewButton: the states (V-B7)', () => {
  it('says Loading… until the feed answers', async () => {
    let answer!: (value: WhatsNewFeed) => void
    mockApiGet.mockReturnValueOnce(new Promise<WhatsNewFeed>(resolve => { answer = resolve }))
    desktop()
    renderButton()
    fireEvent.click(button())

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    await act(async () => answer(feed([entry(1)])))
    expect(await screen.findByText('Entry 1')).toBeInTheDocument()
  })

  it('says "Nothing new yet." when there is nothing', async () => {
    server = feed([])
    desktop()
    renderButton()
    fireEvent.click(button())

    expect(await screen.findByText('Nothing new yet.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ODIP/i)
  })

  it('shows a held "Try again" when the feed fails, and the entries once it answers', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('offline'))
    desktop()
    renderButton()
    fireEvent.click(button())

    expect(await screen.findByText("Couldn't load what's new.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Entry 1')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load what's new.")).toBeNull()
  })

  it('says it could not load it again when the retry fails too', async () => {
    mockApiGet.mockRejectedValue(new Error('offline'))
    desktop()
    renderButton()
    fireEvent.click(button())

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findAllByText("Couldn't load it again.")).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
