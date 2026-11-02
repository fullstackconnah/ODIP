import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PopulatePreviewDto, PopulateResultDto } from '@/api/types'
import { BUDGET_WARNINGS_TITLE } from '@/components/BudgetWarnings'
import { SERVER_PERIOD } from '@/test/fixtures/budgets'
import { PopulateDialog } from './PopulateDialog'

const { previewCall, previewState, populateMutate, populateState } = vi.hoisted(() => ({
  previewCall: vi.fn(),
  previewState: { current: {} as Record<string, unknown> },
  populateMutate: vi.fn(),
  populateState: { current: { isPending: false } as { isPending: boolean } },
}))

vi.mock('@/api/hooks', () => ({
  usePopulatePreview: (participantId: string, id: string, enabled: boolean) => { previewCall(participantId, id, enabled); return previewState.current },
  usePopulateRoster: () => ({ mutate: populateMutate, ...populateState.current }),
}))

const preview = (changes: Partial<PopulatePreviewDto> = {}): PopulatePreviewDto => ({
  weeks: [
    { weekStart: '2026-10-05', toAdd: 0, alreadyThere: 5 },
    { weekStart: '2026-10-12', toAdd: 5, alreadyThere: 0 },
    { weekStart: '2026-10-19', toAdd: 3, alreadyThere: 2 },
  ],
  ...changes,
})

const ready = (data: PopulatePreviewDto) => { previewState.current = { data, isLoading: false, isError: false, error: null, refetch: vi.fn() } }

function setUp() {
  const handlers = { onClose: vi.fn(), onPopulated: vi.fn() }
  render(<PopulateDialog open participantId="p-1" draftId="d-2" {...handlers} />)
  return handlers
}

beforeEach(() => {
  previewCall.mockReset(); populateMutate.mockReset()
  populateState.current = { isPending: false }
  ready(preview())
})

describe('PopulateDialog: one started week at a time', () => {
  it('reads the preview only while open and lists each started week with what it would add', () => {
    setUp()

    expect(previewCall).toHaveBeenCalledWith('p-1', 'd-2', true)
    const select = screen.getByRole('combobox', { name: 'Week' })
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual([
      'Mon 5 Oct 2026 · nothing to add',
      'Mon 12 Oct 2026 · 5 shifts to add',
      'Mon 19 Oct 2026 · 3 shifts to add',
    ])
  })

  it('defaults to the earliest started week that is missing shifts and says what it will add', () => {
    setUp()

    expect(screen.getByRole('combobox', { name: 'Week' })).toHaveValue('2026-10-12')
    expect(screen.getByText('Adds 5 unfilled shifts to the week of Mon 12 Oct 2026. None are already there.')).toBeInTheDocument()
  })

  it('defaults to the first started week when none is missing shifts, and says Nothing to add with Populate off', () => {
    ready(preview({ weeks: [{ weekStart: '2026-10-05', toAdd: 0, alreadyThere: 5 }, { weekStart: '2026-10-12', toAdd: 0, alreadyThere: 5 }] }))
    setUp()

    expect(screen.getByRole('combobox', { name: 'Week' })).toHaveValue('2026-10-05')
    expect(screen.getByText('Nothing to add. All 5 shifts of this week are already there.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Populate roster' })).toBeDisabled()
  })

  it('populates the chosen week, always sending its weekStart', async () => {
    const user = userEvent.setup()
    setUp()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Week' }), '2026-10-19')
    expect(screen.getByText('Adds 3 unfilled shifts to the week of Mon 19 Oct 2026. 2 are already there.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Populate roster' }))

    expect(populateMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-2', weekStart: '2026-10-19' }, expect.any(Object))
  })

  it('hands the result to the page when the server answers', async () => {
    const user = userEvent.setup()
    const result: PopulateResultDto = { created: 5, alreadyThere: 0, weeks: [{ weekStart: '2026-10-12', created: 5, alreadyThere: 0 }] }
    populateMutate.mockImplementation((_vars, options) => options.onSuccess(result))
    const { onPopulated } = setUp()

    await user.click(screen.getByRole('button', { name: 'Populate roster' }))

    expect(onPopulated).toHaveBeenCalledWith(result)
  })

  it('keeps the dialog open and the button focused when the server refuses, saying why', async () => {
    const user = userEvent.setup()
    populateMutate.mockImplementation((_vars, options) => options.onError({ response: { status: 409, data: { code: 'roster-busy', errors: ['The roster is being changed by someone else. Try again in a moment.'] } } }))
    const { onPopulated } = setUp()
    const button = screen.getByRole('button', { name: 'Populate roster' })

    await user.click(button)

    expect(screen.getByRole('alert')).toHaveTextContent('The roster is being changed by someone else. Try again in a moment.')
    expect(onPopulated).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
  })

  it('shows the server budget warning for the chosen week, as a warning only', () => {
    ready(preview({ weeks: [{ weekStart: '2026-10-12', toAdd: 5, alreadyThere: 0, budgetWarnings: [{ poolName: "Core", periodStart: "2026-10-01", periodEnd: "2026-12-31", available: 1000, used: 0, forecast: 1200, added: 1200, overBy: 200, count: 5, message: `These 5 shifts take Core to $1,200.00 of $1,000.00 for ${SERVER_PERIOD}, $200.00 over.` }] }] }))
    setUp()

    expect(screen.getByText(BUDGET_WARNINGS_TITLE)).toBeInTheDocument()
    expect(screen.getByText(/These 5 shifts take Core/)).toBeInTheDocument()
  })

  it('says why nothing can be populated when the server gives a note, with no week to pick', () => {
    ready({ weeks: [], note: 'This revision is not approved yet.' })
    setUp()

    expect(screen.getByText('This revision is not approved yet.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Populate roster' })).not.toBeInTheDocument()
  })

  it('says no week has started when there are none and no note', () => {
    ready({ weeks: [] })
    setUp()

    expect(screen.getByText('No week of this agreement has been started on the roster yet. Start a week first, then populate it.')).toBeInTheDocument()
  })
})
