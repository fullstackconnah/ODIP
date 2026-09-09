import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantPicker } from './ParticipantPicker'
import { FormField } from './FormField'

const { mockUseParticipants } = vi.hoisted(() => ({
  mockUseParticipants: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipants: mockUseParticipants,
}))

const PARTICIPANTS = [
  { id: 'participant-1', firstName: 'Sophie', lastName: 'Brown', fullName: 'Sophie Brown' },
  { id: 'participant-2', firstName: 'Marcus', lastName: 'Lee', fullName: 'Marcus Lee' },
]

describe('ParticipantPicker', () => {
  beforeEach(() => {
    mockUseParticipants.mockReset()
    mockUseParticipants.mockReturnValue({ data: PARTICIPANTS, isLoading: false })
  })

  it('renders options fetched from useParticipants', async () => {
    const user = userEvent.setup()
    render(<ParticipantPicker value="" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    const options = screen.getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['Sophie Brown', 'Marcus Lee'])
  })

  it('requests participants excluding drafts by default (INTAKE-08 convention)', () => {
    render(<ParticipantPicker value="" onChange={vi.fn()} />)

    expect(mockUseParticipants).toHaveBeenCalledWith({ isDraft: 'false' })
  })

  it('requests every participant, including drafts, when excludeDrafts is false', () => {
    render(<ParticipantPicker value="" onChange={vi.fn()} excludeDrafts={false} />)

    expect(mockUseParticipants).toHaveBeenCalledWith(undefined)
  })

  it('filters the option list on typing', async () => {
    const user = userEvent.setup()
    render(<ParticipantPicker value="" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))
    await user.type(screen.getByRole('combobox'), 'marcus')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Marcus Lee')
  })

  it('calls onChange with the participant id, not the label', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ParticipantPicker value="" onChange={onChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Marcus Lee' }))

    expect(onChange).toHaveBeenCalledWith('participant-2')
  })

  it('renders a leading None item when allowNone is set, and reports it as the empty string', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ParticipantPicker value="" onChange={onChange} allowNone noneLabel="None" />)

    await user.click(screen.getByRole('combobox'))
    const options = screen.getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['None', 'Sophie Brown', 'Marcus Lee'])

    await user.click(screen.getByRole('option', { name: 'None' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('does not render a None item when allowNone is unset (default false)', async () => {
    const user = userEvent.setup()
    render(<ParticipantPicker value="" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))
    const options = screen.getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['Sophie Brown', 'Marcus Lee'])
  })

  it('shows a loading state while the participants query is in flight', () => {
    mockUseParticipants.mockReturnValue({ data: [], isLoading: true })
    render(<ParticipantPicker value="" onChange={vi.fn()} />)

    // SearchableSelect renders a spinner in the trigger while loading — the combobox itself
    // stays present and typeable, it just carries no options yet.
    const combobox = screen.getByRole('combobox')
    expect(combobox).not.toBeDisabled()
  })

  it('shows the empty-options message once loading finishes with zero participants', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({ data: [], isLoading: false })
    render(<ParticipantPicker value="" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('No participants available')).toBeInTheDocument()
  })

  it('works inside FormField with a correct accessible name', () => {
    mockUseParticipants.mockReturnValue({ data: PARTICIPANTS, isLoading: false })
    render(
      <FormField label="Involved Participant">
        <ParticipantPicker value="" onChange={vi.fn()} />
      </FormField>,
    )

    expect(screen.getByLabelText('Involved Participant')).toHaveAttribute('role', 'combobox')
  })

  it('shows the selected participant label, resolved from value, when used inside FormField', () => {
    mockUseParticipants.mockReturnValue({ data: PARTICIPANTS, isLoading: false })
    render(
      <FormField label="Involved Participant">
        <ParticipantPicker value="participant-2" onChange={vi.fn()} />
      </FormField>,
    )

    expect(screen.getByLabelText('Involved Participant')).toHaveValue('Marcus Lee')
  })

  it('shows no truncation notice when the list is not truncated', () => {
    const notTruncated = Object.assign([...PARTICIPANTS], { isTruncated: false, totalCount: 2 })
    mockUseParticipants.mockReturnValue({ data: notTruncated, isLoading: false })
    render(<ParticipantPicker value="" onChange={vi.fn()} />)

    expect(screen.queryByText(/refine your search/i)).not.toBeInTheDocument()
  })

  it('shows no truncation notice for a plain array with no isTruncated field (e.g. the loading default)', () => {
    mockUseParticipants.mockReturnValue({ data: [], isLoading: true })
    render(<ParticipantPicker value="" onChange={vi.fn()} />)

    expect(screen.queryByText(/refine your search/i)).not.toBeInTheDocument()
  })

  it('shows a visible notice when the participant list was truncated to the page-size ceiling', () => {
    const truncated = Object.assign(Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, fullName: `Participant ${i}` })), {
      isTruncated: true,
      totalCount: 340,
    })
    mockUseParticipants.mockReturnValue({ data: truncated, isLoading: false })
    render(<ParticipantPicker value="" onChange={vi.fn()} />)

    expect(screen.getByText('Showing the first 200 of 340 participants — refine your search to find someone else.')).toBeInTheDocument()
  })
})
