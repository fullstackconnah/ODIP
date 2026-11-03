import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import ReportProblemDialog from './ReportProblemDialog'

const { mockApiPost } = vi.hoisted(() => ({ mockApiPost: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiPost: mockApiPost }))
vi.mock('@/lib/platformInfo', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/platformInfo')>()
  return { ...real, PLATFORM_INFO: { ...real.PLATFORM_INFO, version: '1.4.2', buildSha: 'abcdef0123456789' } }
})

const PATH = '/participants/3f2a9c01-1111-4222-8333-444455556666/notes?tab=2#top'
const onClose = vi.fn()

/** The copy keeps "Bunya Support" whole with a no-break space and a word joiner; compare without them. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u00a0\u2060]/g, ' ').replace(/\s+/g, ' ').trim()
const hasText = (expected: string) => (_: string, el: Element | null) => !!el && el.children.length === 0 && plain(el.textContent) === expected

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[PATH]}>
        <ReportProblemDialog open onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const box = () => screen.getByLabelText('What happened?') as HTMLTextAreaElement
const send = () => screen.getByRole('button', { name: /^Send/ })
const type = (value: string) => fireEvent.change(box(), { target: { value } })

function failWith(status: number, errors?: string[]) {
  mockApiPost.mockRejectedValue({ response: { status, data: { success: false, errors } } })
}

beforeEach(() => {
  mockApiPost.mockReset()
  onClose.mockReset()
})

describe('ReportProblemDialog', () => {
  it('opens on the empty textarea with the lead, the always-visible hint and a 0 / 2000 counter', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Report a problem' })).toBeInTheDocument()
    expect(screen.getByText("Tell us what went wrong and we'll look into it.")).toBeInTheDocument()
    expect(screen.getByText("Don't include participant names. We add this page, the app version, your browser, your organisation and your name.")).toBeInTheDocument()
    expect(screen.getByText('0 / 2000')).toBeInTheDocument()
    expect(box()).toHaveFocus()
    expect(box()).toHaveAttribute('maxlength', '2000')
  })

  it('sends only text, pagePath and appVersion, with the path cleaned', async () => {
    mockApiPost.mockResolvedValue({ id: 'r1', status: 'Sent' })
    renderDialog()
    type('The roster would not load')
    fireEvent.click(send())
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))
    expect(mockApiPost).toHaveBeenCalledWith('/problem-reports', {
      text: 'The roster would not load',
      pagePath: '/participants/:id/notes',
      appVersion: '1.4.2 (abcdef0)',
    })
  })

  it('says Sent, then offers one focused Done that closes', async () => {
    mockApiPost.mockResolvedValue({ id: 'r1', status: 'Sent' })
    renderDialog()
    type('Something broke')
    fireEvent.click(send())
    await screen.findByText(hasText('Sent. Thanks, the Bunya Support team has your report.'))
    expect(screen.queryByLabelText('What happened?')).not.toBeInTheDocument()
    const done = screen.getByRole('button', { name: 'Done' })
    expect(done).toHaveFocus()
    fireEvent.click(done)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says Saved when the server could not reach the team, and tells them not to resend', async () => {
    mockApiPost.mockResolvedValue({ id: 'r1', status: 'Saved' })
    renderDialog()
    type('Something broke')
    fireEvent.click(send())
    await screen.findByText(hasText("Saved. We couldn't reach the Bunya Support team just now, so we'll send it shortly. You don't need to send it again."))
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus()
  })

  it('keeps the text and the focus on Send after a failure', async () => {
    failWith(500)
    renderDialog()
    type('Something broke')
    fireEvent.click(send())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Your report wasn't sent. Check your connection and try again.")
    expect(box().value).toBe('Something broke')
    expect(send()).toHaveFocus()
  })

  it('shows the 429 copy', async () => {
    failWith(429)
    renderDialog()
    type('Again')
    fireEvent.click(send())
    expect(await screen.findByRole('alert')).toHaveTextContent("You've sent a few reports in a row. Try again in a few minutes.")
  })

  it("shows the server's own words on a 400", async () => {
    failWith(400, ['Keep it under 2,000 characters.'])
    renderDialog()
    type('Too much')
    fireEvent.click(send())
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep it under 2,000 characters.')
  })

  it('sends nothing for blank text and moves focus to the textarea', () => {
    renderDialog()
    type('   ')
    send().focus()
    fireEvent.click(send())
    expect(mockApiPost).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Write a few words about what went wrong.')
    expect(box()).toHaveFocus()
  })

  it('turns the counter destructive from 1800 and keeps it muted at 1799', () => {
    renderDialog()
    type('a'.repeat(1799))
    expect(screen.getByText('1799 / 2000').className).not.toContain('destructive')
    type('a'.repeat(1800))
    expect(screen.getByText('1800 / 2000').className).toContain('destructive')
  })

  it('while sending: Sending… with aria-busy, read-only text, Cancel still works, Escape is ignored', async () => {
    let finish: (v: unknown) => void = () => {}
    mockApiPost.mockReturnValue(new Promise(r => { finish = r }))
    renderDialog()
    type('Slow one')
    fireEvent.click(send())
    const busy = await screen.findByRole('button', { name: 'Sending…' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(box()).toHaveAttribute('readonly')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ id: 'r1', status: 'Sent' }) })
  })

  it('Escape closes while writing', () => {
    renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
