import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminWhatsNewEntry } from '@/api/types'
import WhatsNewSection from './WhatsNewSection'

const { mockApiGet, mockApiPost, mockApiPut } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPost: vi.fn(), mockApiPut: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet: mockApiGet, apiPost: mockApiPost, apiPut: mockApiPut }))

const ALL = ['Admin', 'Coordinator', 'SupportWorker', 'ReadOnly'] as const
// Live rows have no archivedAtUtc at all, as the server sends them.
const rows: AdminWhatsNewEntry[] = [
  { id: 'a', key: 'k-a', title: 'Newest entry', body: 'Body A\n\nSecond', important: true, roles: [...ALL], publishedAtUtc: '2026-10-24T14:00:00Z', updatedAt: '2026-10-24T14:00:00Z' },
  { id: 'b', key: 'k-b', title: 'Admins only', body: 'Body B', important: false, roles: ['Admin', 'Coordinator'], publishedAtUtc: '2026-10-20T01:00:00Z', updatedAt: '2026-10-20T01:00:00Z' },
  { id: 'c', key: 'k-c', title: 'Old one', body: 'Body C', important: false, roles: [...ALL], archivedAtUtc: '2026-10-21T01:00:00Z', publishedAtUtc: '2026-10-10T01:00:00Z', updatedAt: '2026-10-21T01:00:00Z' },
]

beforeEach(() => {
  mockApiGet.mockReset()
  mockApiPost.mockReset()
  mockApiPut.mockReset()
  mockApiGet.mockResolvedValue(rows)
  mockApiPost.mockResolvedValue(rows[0])
  mockApiPut.mockResolvedValue(rows[0])
})

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><WhatsNewSection /></QueryClientProvider>)
}

const ready = async () => { await screen.findByText('Newest entry') }
const fill = () => {
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: '  Hello there  ' } })
  fireEvent.change(screen.getByLabelText(/^Text/), { target: { value: ' Some text ' } })
}

describe('WhatsNewSection', () => {
  it('V-S1: lists newest first, says Everyone for all four roles, Archive on live rows and Restore on archived ones', async () => {
    renderSection()
    await ready()
    const body = screen.getAllByRole('row').slice(1).map(r => r.textContent ?? '')
    expect(body[0]).toContain('Newest entry')
    expect(body[0]).toContain('Everyone')
    expect(body[0]).toContain('Published')
    expect(body[0]).toContain('25 Oct 2026')
    expect(body[1]).toContain('Admin, Coordinator')
    expect(body[2]).toContain('Archived')
    expect(screen.getByRole('button', { name: 'Archive: Newest entry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore: Old one' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive: Old one' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/ODIP/i)
  })

  it('V-S2: Add, fill, Publish creates with trimmed values and roles in house order, then closes the panel', async () => {
    renderSection()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    fill()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Important' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/admin/whats-new', expect.objectContaining({
      title: 'Hello there', body: 'Some text', roles: ['Admin', 'Coordinator', 'SupportWorker', 'ReadOnly'], important: true,
    })))
    await waitFor(() => expect(screen.queryByText('Add entry', { selector: 'h2, span' })).toBeNull())
  })

  it('V-S3: an empty submit shows the three messages with focus on Title; the counters turn destructive at 90%', async () => {
    renderSection()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    for (const name of ['Admin', 'Coordinator', 'Support worker', 'Read-only']) fireEvent.click(screen.getByRole('checkbox', { name })) // untick all
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('Enter a title.')).toBeInTheDocument()
    expect(screen.getByText('Enter the text people will read.')).toBeInTheDocument()
    expect(screen.getByText('Choose at least one role.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText(/Title/)).toHaveFocus())
    expect(mockApiPost).not.toHaveBeenCalled()

    const title = screen.getByLabelText(/Title/)
    fireEvent.change(title, { target: { value: 'x'.repeat(71) } })
    expect(screen.getByText('71 / 80')).not.toHaveClass('text-[var(--color-destructive)]')
    fireEvent.change(title, { target: { value: 'x'.repeat(72) } })
    expect(screen.getByText('72 / 80')).toHaveClass('text-[var(--color-destructive)]')
    fireEvent.change(screen.getByLabelText(/^Text/), { target: { value: 'y'.repeat(540) } })
    expect(screen.getByText('540 / 600')).toHaveClass('text-[var(--color-destructive)]')
  })

  it('V-S4: a refused save shows the form message and keeps what was typed', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('400'))
    renderSection()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText("Couldn't save the entry. Check the fields and try again.")).toBeInTheDocument()
    expect(screen.getByLabelText(/Title/)).toHaveValue('  Hello there  ')
    expect(screen.getByLabelText(/^Text/)).toHaveValue(' Some text ')
  })

  it('V-S5: Archive asks first and cancel does nothing; Restore calls at once with no dialog', async () => {
    renderSection()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Archive: Newest entry' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive this entry?' })
    expect(within(dialog).getByText(/"Newest entry" will no longer show in What's new for anyone/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(mockApiPost).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Archive: Newest entry' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Archive this entry?' })).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/admin/whats-new/a/archive'))

    mockApiPost.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Restore: Old one' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/admin/whats-new/c/restore'))
  })

  it('V-S5: a failed archive says so above the table', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('500'))
    renderSection()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Archive: Newest entry' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByText('Couldn\'t archive "Newest entry". Try again.')).toBeInTheDocument()
  })

  it('V-S6: Edit pre-fills, says edits do not mark it new, and saves through update', async () => {
    renderSection()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Admins only' }))
    expect(screen.getByLabelText(/Title/)).toHaveValue('Admins only')
    expect(screen.getByText("Edits don't mark it as new again.")).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Support worker' })).not.toBeChecked()

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Admins only!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith('/admin/whats-new/b', expect.objectContaining({
      title: 'Admins only!', body: 'Body B', roles: ['Admin', 'Coordinator'], important: false,
    })))
    expect(mockApiPost).not.toHaveBeenCalled()
  })
})
