import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsHistorySection from './SettingsHistorySection'

const api = vi.hoisted(() => ({ settings: vi.fn(), audit: vi.fn() }))
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  apiGetWithDefault: async (_url: string, fallback: unknown) => (await api.settings()) ?? fallback,
  apiClient: { get: api.audit },
}))

const entry = (id: string, changes: { field: string; old: string | null; new: string | null }[]) =>
  ({ id, action: 'Updated', changedAt: '2026-11-10T01:00:00Z', changedByName: 'Sam Admin', changes })
const history = (entries: ReturnType<typeof entry>[], total = entries.length) => ({ data: { entries, total, page: 1, pageSize: 50, totalPages: 1 } })
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SettingsHistorySection /></QueryClientProvider>)
const pulseRows = (container: HTMLElement) => container.querySelectorAll('.animate-pulse')

beforeEach(() => { vi.clearAllMocks(); api.settings.mockResolvedValue({ id: 'ps-1' }); api.audit.mockResolvedValue(history([])) })

describe('Settings history', () => {
  it('shows three skeleton rows and no text while the settings load', () => {
    api.settings.mockReturnValue(new Promise(() => {}))
    const { container } = show()
    expect(pulseRows(container)).toHaveLength(3)
    expect(container.textContent).toBe('')
  })

  it('shows the same skeleton while the history loads', async () => {
    api.audit.mockReturnValue(new Promise(() => {}))
    const { container } = show()
    await vi.waitFor(() => expect(api.audit).toHaveBeenCalledWith('/audit/ProviderSettings/ps-1'))
    expect(pulseRows(container)).toHaveLength(3)
    expect(container.textContent).toBe('')
  })

  it('says there is no history when there are no rows', async () => {
    show()
    expect(await screen.findByText('No history recorded yet.')).toBeInTheDocument()
  })

  it('says so without asking for history when the organisation has no settings row', async () => {
    api.settings.mockResolvedValue(null)
    show()
    expect(await screen.findByText('No history recorded yet.')).toBeInTheDocument()
    expect(api.audit).not.toHaveBeenCalled()
  })

  it('shows a failed history with Try again, which asks again', async () => {
    api.audit.mockRejectedValueOnce(new Error('500'))
    show()
    expect(await screen.findByText(/Couldn't load this history\./)).toBeInTheDocument()
    api.audit.mockResolvedValue(history([entry('a', [{ field: 'State', old: 'VIC', new: 'NSW' }])]))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('NSW')).toBeInTheDocument()
    expect(api.audit).toHaveBeenCalledTimes(2)
  })

  it('shows a failed settings read as the same error', async () => {
    api.settings.mockRejectedValue(new Error('500'))
    show()
    expect(await screen.findByText(/Couldn't load this history\./)).toBeInTheDocument()
  })

  it('names each field as Settings does, reads True and False as Yes and No, and leaves an unknown field raw', async () => {
    api.audit.mockResolvedValue(history([entry('a', [
      { field: 'GSTRegistered', old: 'False', new: 'True' },
      { field: 'ParticipantReadinessMode', old: 'Warn', new: 'Enforce' },
      { field: 'SomethingNew', old: null, new: 'x' },
    ])]))
    show()
    expect(await screen.findByText('Registered for GST')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('Participant readiness check')).toBeInTheDocument()
    expect(screen.getByText('SomethingNew')).toBeInTheDocument()
    expect(screen.getByText('by Sam Admin')).toBeInTheDocument()
    expect(screen.getByText('1 event recorded')).toBeInTheDocument()
  })

  it('reads a mode and a time zone in the words Settings shows for them, and leaves a value it has no option for as stored (PSA-O3)', async () => {
    api.audit.mockResolvedValue(history([entry('a', [
      { field: 'ParticipantReadinessMode', old: 'Warn', new: 'Enforce' },
      { field: 'MedicationCompetencyMode', old: 'Enforce', new: 'Warn' },
      { field: 'TimeZoneId', old: 'Australia/Sydney', new: 'Australia/Brisbane' },
      { field: 'State', old: 'VIC', new: 'NSW' },
      { field: 'BankAccountName', old: null, new: 'McDonald Care' },
    ])]))
    show()
    expect(await screen.findByText('Participant readiness check')).toBeInTheDocument()
    expect(screen.getAllByText('Warn only')).toHaveLength(2)
    expect(screen.getAllByText('Enforce')).toHaveLength(2)
    expect(screen.getByText('Sydney (NSW, ACT)')).toBeInTheDocument()
    expect(screen.getByText('Brisbane (QLD)')).toBeInTheDocument()
    expect(screen.queryByText('Warn')).not.toBeInTheDocument()
    expect(screen.getByText('VIC')).toBeInTheDocument()
    expect(screen.getByText('McDonald Care')).toBeInTheDocument()
  })

  it('shows the Onboarding checklist value one item per line, split on commas or on semicolons, with no empty line', async () => {
    api.audit.mockResolvedValue(history([entry('a', [{
      field: 'OnboardingItemModes',
      old: 'complaints=Required, rights=Required, myProvider=Required, budget=Off',
      new: 'complaints=Required; rights=Optional,  ; myProvider=Required, budget=Off',
    }])]))
    show()
    await screen.findByText('Onboarding checklist')
    const [before, after] = screen.getAllByRole('list')
    expect(within(before).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Told how to make a complaint: Required', 'Rights explained: Required', 'Recorded as my provider: Required', 'Plan budget added: Off'])
    expect(within(after).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Told how to make a complaint: Required', 'Rights explained: Optional', 'Recorded as my provider: Required', 'Plan budget added: Off'])
  })

  it('keeps the stored key for an Onboarding item the form does not know, even one named like an object property', async () => {
    api.audit.mockResolvedValue(history([entry('a', [{ field: 'OnboardingItemModes', old: 'other=Required, constructor=Optional', new: 'other=Optional, constructor=Optional' }])]))
    show()
    await screen.findByText('Onboarding checklist')
    const [before, after] = screen.getAllByRole('list')
    expect(within(before).getAllByRole('listitem').map(li => li.textContent)).toEqual(['other: Required', 'constructor: Optional'])
    expect(within(after).getAllByRole('listitem').map(li => li.textContent)).toEqual(['other: Optional', 'constructor: Optional'])
  })

  it('shows a masked bank row as set, changed or cleared, never as digits', async () => {
    api.audit.mockResolvedValue(history([entry('a', [{ field: 'AccountNumber', old: null, new: 'changed' }])]))
    const { container } = show()
    expect(await screen.findByText('Bank account number')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('changed')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\d{6,}/)
  })

  it('says it shows the latest 50 when there are more', async () => {
    api.audit.mockResolvedValue(history(Array.from({ length: 50 }, (_, i) => entry(`e${i}`, [{ field: 'State', old: 'VIC', new: 'NSW' }])), 51))
    show()
    expect(await screen.findByText('Showing the latest 50 of 51 events')).toBeInTheDocument()
  })
})
