import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SupportProfileTopicCard, type SupportProfileState } from './SupportProfileTopicCard'
import { hasTopic } from './recorded'
import type { SupportProfileDto } from '@/api/types/participants'

const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useUpdateSupportProfile: () => ({ mutateAsync: mockUpdate, isPending: false }),
}))

const profile = { id: 'sp1', participantId: 'participant-1', emergencyConsiderations: 'Seizure plan on fridge', reviewDate: '2026-03-04T00:00:00Z' } as SupportProfileDto
const ready = (p?: SupportProfileDto): SupportProfileState => ({ profile: p, loading: false, error: false, retry: vi.fn() })

beforeEach(() => mockUpdate.mockReset())

describe('SupportProfileTopicCard (T15)', () => {
  it('saves only its own field', async () => {
    const user = userEvent.setup()
    mockUpdate.mockResolvedValue({})
    render(<SupportProfileTopicCard title="Emergency" field="emergencyConsiderations" participantId="participant-1" canEdit state={ready(profile)} />)
    await user.click(screen.getByRole('button', { name: /edit/i }))
    const box = screen.getByRole('textbox')
    await user.clear(box)
    await user.type(box, 'Call 000')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'participant-1', fields: { emergencyConsiderations: 'Call 000' } })
  })

  it('shows no Edit for a role that cannot edit, and no error for a participant with no profile yet', () => {
    render(<SupportProfileTopicCard title="Emergency" field="emergencyConsiderations" participantId="participant-1" canEdit={false} state={ready(undefined)} />)
    expect(screen.queryByRole('button', { name: /edit|add/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('has Edit disabled while the profile loads', () => {
    render(<SupportProfileTopicCard title="Emergency" field="emergencyConsiderations" participantId="participant-1" canEdit state={{ ...ready(), loading: true }} />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Loading emergency')
  })

  it('shows the house error with Retry, and Edit disabled, when the load failed', async () => {
    const user = userEvent.setup()
    const state = { ...ready(), error: true }
    render(<SupportProfileTopicCard title="Emergency" field="emergencyConsiderations" participantId="participant-1" canEdit state={state} />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByText(/Couldn't load the support profile\./)).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(retry).toHaveClass('min-h-[var(--tap-min)]')
    await user.click(retry)
    expect(state.retry).toHaveBeenCalled()
  })

  it('an all-empty card has the header Edit and no Add; viewers get neither', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<SupportProfileTopicCard title="Emergency" field="emergencyConsiderations" participantId="participant-1" canEdit state={ready(undefined)} />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    unmount()
    render(<SupportProfileTopicCard title="Emergency" field="emergencyConsiderations" participantId="participant-1" canEdit={false} state={ready(undefined)} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('formats the review date and edits it as a date', async () => {
    const user = userEvent.setup()
    mockUpdate.mockResolvedValue({})
    render(<SupportProfileTopicCard title="Support profile review" field="reviewDate" participantId="participant-1" canEdit state={ready(profile)} />)
    expect(screen.getByText(/2026/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit/i }))
    expect((screen.getByLabelText('Review date') as HTMLInputElement).value).toBe('2026-03-04')
  })

  it('hasTopic is true only for a non-empty field', () => {
    expect(hasTopic(profile, 'emergencyConsiderations')).toBe(true)
    expect(hasTopic(profile, 'travelSpecificNotes')).toBe(false)
    expect(hasTopic(undefined, 'emergencyConsiderations')).toBe(false)
  })
})
