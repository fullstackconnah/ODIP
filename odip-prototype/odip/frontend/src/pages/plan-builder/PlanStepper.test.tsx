import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { DraftBlock, PlanPricingSettingsDto } from '@/api/types'
import type { PlanStepKey } from '@/lib/planBlocks'
import { PLAN_TEMPLATES, type PlanTemplate } from '@/lib/planTemplates'
import { draftBlock, mondayWednesday, quote, settings as makeSettings } from '@/test/fixtures/planPricing'
import { PlanStepper } from './PlanStepper'

vi.mock('@/api/hooks', () => ({
  usePlanBlockQuote: () => ({ data: quote(), isLoading: false, isError: false, refetch: vi.fn() }),
}))

type HarnessProps = {
  mode?: 'new' | 'edit'
  initial?: DraftBlock
  hasBlock?: boolean
  step?: PlanStepKey
  settings?: PlanPricingSettingsDto
  onSave?: (entry: DraftBlock) => void
  onCancel?: () => void
  from?: string
  to?: string
}

/** The stepper is controlled: the builder owns the block and the step. This is the smallest owner. */
function Harness({ mode = 'new', initial = draftBlock(), hasBlock = true, step: firstStep = 'times', settings, onSave, onCancel, from = '2026-10-01', to = '2027-06-30' }: HarnessProps) {
  const [entry, setEntry] = useState(initial)
  const [step, setStep] = useState<PlanStepKey>(firstStep)
  const [chosen, setChosen] = useState(hasBlock)
  const [templateKey, setTemplateKey] = useState<string | null>(null)
  return (
    <MemoryRouter>
      <PlanStepper
        mode={mode} entry={entry} templateKey={templateKey} hasBlock={chosen} step={step} onStepChange={setStep} onChange={setEntry}
        onChooseTemplate={(template: PlanTemplate) => { setEntry(template.build(entry.block.id, 'NSW', 'National')); setTemplateKey(template.key); setChosen(true) }}
        onCancel={onCancel ?? vi.fn()} onSave={() => onSave?.(entry)} settings={settings} others={[]} from={from} to={to} state="NSW" zone="National" week={{ from: '2026-10-12', to: '2026-10-18' }} planIssues={[]}
      />
    </MemoryRouter>
  )
}

beforeEach(() => localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' })))
afterEach(() => localStorage.clear())

const heading = () => screen.getByRole('heading', { level: 2 })

describe('PlanStepper navigation', () => {
  it('shows the step it is on, "Step 2 of 5 · Days and times" for a phone and the rail beside it for a desk, and moves one step at a time with Back and Next', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.getByText('Step 2 of 5 · Days and times')).toBeInTheDocument()
    expect(heading()).toHaveTextContent('Days and times')
    const rail = screen.getByRole('navigation', { name: 'Block steps' })
    expect(within(rail).getAllByRole('button').map(button => (button.textContent ?? '').replace(/^\d/, ''))).toEqual(['Template', 'Days and times', 'Requirements', 'Travel and transport', 'Review'])
    expect(within(rail).getByRole('button', { name: /Days and times/ })).toHaveAttribute('aria-current', 'step')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(heading()).toHaveTextContent('Requirements')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(heading()).toHaveTextContent('Travel and transport')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(heading()).toHaveTextContent('Requirements')
  })

  it('moves focus to the new step\'s heading, so a keyboard or screen reader user starts at the top of it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(heading()).toHaveFocus()
  })

  it('makes Enter in a field the same as Next', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    screen.getByLabelText('Starts').focus()
    await user.keyboard('{Enter}')

    expect(heading()).toHaveTextContent('Requirements')
  })

  it('reaches any step from the rail once a block exists, and only the Template step before one does', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness hasBlock={false} step="template" />)
    const before = within(screen.getByRole('navigation', { name: 'Block steps' })).getAllByRole('button')
    expect(before.map(button => (button as HTMLButtonElement).disabled)).toEqual([false, true, true, true, true])
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    unmount()

    render(<Harness />)
    await user.click(within(screen.getByRole('navigation', { name: 'Block steps' })).getByRole('button', { name: /Review$/ }))
    expect(heading()).toHaveTextContent('Review')
  })

  it('has no Back on the first step, and Cancel on every one', () => {
    const onCancel = vi.fn()
    render(<Harness hasBlock={false} step="template" onCancel={onCancel} />)

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('PlanStepper Template step', () => {
  it('fills the block in from the template chosen, and then Next goes to the times', async () => {
    const user = userEvent.setup()
    render(<Harness mode="new" hasBlock={false} step="template" initial={draftBlock(mondayWednesday('b9', { days: [] }))} />)

    await user.click(screen.getByRole('radio', { name: /Saturday group outing 1:3/ }))
    expect(screen.getByRole('radio', { name: /Saturday group outing 1:3/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(heading()).toHaveTextContent('Days and times')
    expect(screen.getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Ends')).toHaveValue('15:00')
  })

  it('warns that choosing a template over a block being changed replaces its days, times and requirements', () => {
    render(<Harness mode="edit" step="template" />)
    expect(screen.getByText(/replaces this block's days, times and requirements/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Start again from a template' })).toBeInTheDocument()
  })

  it('offers every template once', () => {
    render(<Harness hasBlock={false} step="template" />)
    expect(screen.getAllByRole('radio').map(radio => (radio as HTMLInputElement).value)).toEqual(PLAN_TEMPLATES.map(template => template.key))
  })
})

describe('PlanStepper Days and times step', () => {
  it('toggles days, and says "ends the next day" in words when the times say so', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftBlock(mondayWednesday('b1', { days: ['Monday'] }))} />)

    await user.click(screen.getByRole('button', { name: 'Tuesday' }))
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Monday' }))
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false')

    expect(screen.getByText(/Ends the same day at 13:00: 4 h in all\./)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '02:00' } })
    expect(screen.getByText('Ends the next day').closest('p')).toHaveTextContent('Ends the next day at 02:00: 17 h in all.')
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '09:00' } })
    expect(screen.getByText('Ends the next day.').closest('p')).toHaveTextContent('The same time twice is a 24 hour block.')
  })

  it('draws where the prices change inside the block', () => {
    render(<Harness initial={draftBlock(mondayWednesday('b1', { start: '18:00:00', end: '23:00:00' }))} />)

    expect(screen.getByRole('img', { name: /Weekday price bands/ }).getAttribute('aria-label')).toContain('Daytime 18:00–20:00 (2 h); Evening 20:00–23:00 (3 h)')
  })

  it('refuses to move on without a day, says so next to the field, announces it, and lets go once a day is chosen', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftBlock(mondayWednesday('b1', { days: [] }))} />)

    expect(screen.queryByText('Choose at least one day.')).not.toBeInTheDocument()   // nothing is said before anyone has tried to leave
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(heading()).toHaveTextContent('Days and times')
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one day.')
    await user.click(screen.getByRole('button', { name: 'Thursday' }))
    expect(screen.queryByText('Choose at least one day.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(heading()).toHaveTextContent('Requirements')
  })

  it('says an emptied time is missing, next to it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Enter a start time.')).toBeInTheDocument()
  })

  it('offers a sleepover only when the block could be one', async () => {
    const user = userEvent.setup()
    const overnight = (changes = {}) => draftBlock(mondayWednesday('b1', { supportType: 'PersonalCare', days: ['Friday'], start: '22:00:00', end: '06:00:00', ...changes }))
    const { unmount } = render(<Harness initial={overnight({ supportType: 'CommunityAccess' })} />)
    expect(screen.queryByRole('checkbox', { name: /A worker may sleep/ })).not.toBeInTheDocument()   // community access has no sleepover item
    unmount()

    const second = render(<Harness initial={overnight({ start: '09:00:00', end: '17:00:00' })} />)
    expect(screen.queryByRole('checkbox', { name: /A worker may sleep/ })).not.toBeInTheDocument()   // not across midnight
    second.unmount()

    render(<Harness initial={overnight()} />)
    const choice = screen.getByRole('checkbox', { name: /A worker may sleep/ })
    expect(choice).not.toBeChecked()
    expect(screen.queryByLabelText('Active hours in the night')).not.toBeInTheDocument()
    await user.click(choice)
    expect(choice).toBeChecked()
    expect(screen.getByLabelText('Active hours in the night')).toBeInTheDocument()
  })

  it('lets go of the sleepover when new times mean the block can no longer be one, instead of pricing a choice nobody can see', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftBlock(mondayWednesday('b1', { supportType: 'PersonalCare', days: ['Friday'], start: '22:00:00', end: '06:00:00', workerMaySleep: true, sleepoverActiveHours: 1 }))} />)
    expect(screen.getByRole('checkbox', { name: /A worker may sleep/ })).toBeChecked()

    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '03:00' } })
    expect(screen.queryByRole('checkbox', { name: /A worker may sleep/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '06:00' } })

    expect(screen.getByRole('checkbox', { name: /A worker may sleep/ })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Next' }))
  })

  it('asks for the sleeping window once a block is longer than 12 hours, filled in from 22:00 to 06:00', async () => {
    const user = userEvent.setup()
    render(<Harness initial={draftBlock(mondayWednesday('b1', { supportType: 'StaSupport', days: ['Friday'], start: '16:00:00', end: '16:00:00' }))} />)

    await user.click(screen.getByRole('checkbox', { name: /A worker may sleep/ }))

    expect(screen.getByLabelText('Sleeping from')).toHaveValue('22:00')
    expect(screen.getByLabelText('Sleeping until')).toHaveValue('06:00')
  })
})

describe('PlanStepper Requirements step', () => {
  const toRequirements = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getByRole('button', { name: 'Next' })) }

  it('offers only the support types the provider holds a registration group for', async () => {
    const user = userEvent.setup()
    render(<Harness settings={makeSettings({ registrationGroupsHeld: ['0107', '0125'] })} />)
    await toRequirements(user)

    await user.click(screen.getByLabelText('Support type'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.textContent)).toEqual(['Community access', 'Personal care'])
  })

  it('shows a type the block already has even if the group is not held, with the reason next to the field, once the person tries to move on', async () => {
    const user = userEvent.setup()
    render(<Harness settings={makeSettings({ registrationGroupsHeld: ['0107'] })} />)
    await toRequirements(user)

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Community access needs registration group 0125, which your organisation has not recorded as held.')).toBeInTheDocument()
    expect(heading()).toHaveTextContent('Requirements')
  })

  it('says what the ratio does to the price as the numbers are typed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await toRequirements(user)

    expect(screen.getByText('One worker for one participant: the full hourly price.')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Participants present'))
    await user.type(screen.getByLabelText('Participants present'), '3')
    expect(screen.getByText("1:3. Each participant's hourly price is the NDIS maximum divided by 3, rounded down to the cent.")).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Workers'))
    await user.type(screen.getByLabelText('Workers'), '2')
    expect(screen.getByText(/2:3\. Each participant's hourly price is the NDIS maximum times 2 divided by 3/)).toBeInTheDocument()
  })

  it('says workers out of range next to the field when the person tries to move on', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await toRequirements(user)

    await user.clear(screen.getByLabelText('Workers'))
    await user.type(screen.getByLabelText('Workers'), '11')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Workers must be between 1 and 10.')).toBeInTheDocument()
  })

  it('keeps worker requirements as chips, never names, and reports each change', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness mode="edit" step="requirements" onSave={onSave} />)

    expect(screen.getByText(/Requirements only, never names/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Female worker' }))
    await user.click(screen.getByRole('button', { name: 'Driver' }))
    await user.click(screen.getByRole('button', { name: 'First aid' }))
    await user.click(screen.getByRole('button', { name: 'Manual handling' }))
    await user.click(screen.getByRole('button', { name: 'First aid' }))   // and off again
    await user.click(screen.getByRole('button', { name: 'Save block' }))

    expect(onSave.mock.calls[0][0].requirements).toEqual({ workerGender: 'Female', driver: true, skills: ['ManualHandling'] })
    expect(screen.getByRole('button', { name: 'Driver' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'First aid' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches the intensity and the setting', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness mode="edit" step="requirements" onSave={onSave} />)

    await user.click(screen.getByRole('radio', { name: 'High intensity' }))
    await user.click(screen.getByRole('radio', { name: 'Centre' }))
    await user.click(screen.getByRole('button', { name: 'Save block' }))

    expect(onSave.mock.calls[0][0].block).toMatchObject({ intensity: 'HighIntensity', setting: 'Centre' })
    expect(screen.getByText(/A centre adds the centre capital cost/)).toBeInTheDocument()
  })
})

describe('PlanStepper Travel and transport step', () => {
  it('prices nothing for travel until it is switched on, and then asks for the minutes, the kilometres and who shares the trip', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness mode="edit" step="travel" onSave={onSave} settings={makeSettings()} />)

    expect(screen.queryByLabelText('Minutes each way')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Claim provider travel' }))
    expect(screen.getByLabelText('Minutes each way')).toHaveValue(15)
    fireEvent.change(screen.getByLabelText('Minutes each way'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Kilometres each way'), { target: { value: '8.5' } })
    await user.click(screen.getByRole('checkbox', { name: 'Also claim the trip back to base' }))
    await user.click(screen.getByRole('button', { name: 'Save block' }))

    expect(onSave.mock.calls[0][0].block.travel).toEqual({ claim: true, minutesEachWay: 25, returnToBase: true, kmEachWay: 8.5 })
  })

  it('says travel is off when the provider has turned it off, and offers no control for it', () => {
    render(<Harness mode="edit" step="travel" settings={makeSettings({ claimProviderTravel: false })} />)

    expect(screen.getByText('Your organisation has turned provider travel off in Settings, so none is priced.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Claim provider travel' })).not.toBeInTheDocument()
  })

  it('warns that the per-kilometre rates are 2025-26 values while the settings say so', () => {
    const { unmount } = render(<Harness mode="edit" step="travel" settings={makeSettings({ travelRatesProvisional: true })} />)
    expect(screen.getByText(/2025-26 values until NDIA publishes 2026-27/)).toBeInTheDocument()
    unmount()
    render(<Harness mode="edit" step="travel" settings={makeSettings({ travelRatesProvisional: false })} />)
    expect(screen.queryByText(/2025-26 values until NDIA publishes 2026-27/)).not.toBeInTheDocument()
  })

  it('adds activity-based transport with a vehicle, tolls and parking at cost, shared by whoever is in the vehicle', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness mode="edit" step="travel" onSave={onSave} initial={draftBlock(mondayWednesday('b1', { participantsPresent: 3 }))} />)

    await user.click(screen.getByRole('checkbox', { name: 'Add activity-based transport' }))
    fireEvent.change(screen.getByLabelText('Kilometres'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Tolls ($, at cost)'), { target: { value: '4.5' } })
    fireEvent.change(screen.getByLabelText('Parking ($, at cost)'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Participants sharing the vehicle'), { target: { value: '2' } })
    await user.click(screen.getByRole('radio', { name: 'Accessible vehicle or bus' }))
    await user.click(screen.getByRole('button', { name: 'Save block' }))

    expect(onSave.mock.calls[0][0].block.transport).toEqual({ km: 20, vehicle: 'Accessible', tolls: 4.5, parking: 8, participantsSharing: 2 })
  })

  it('keeps "everyone present" as the default for sharing, and lets go of a count the block can no longer have', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness mode="edit" step="travel" onSave={onSave} initial={draftBlock(mondayWednesday('b1', { participantsPresent: 3 }))} />)

    await user.click(screen.getByRole('checkbox', { name: 'Add activity-based transport' }))
    expect(screen.getByLabelText('Participants sharing the vehicle')).toHaveValue(3)
    await user.click(screen.getByRole('button', { name: 'Save block' }))

    expect(onSave.mock.calls[0][0].block.transport.participantsSharing).toBeUndefined()
  })

  it('says transport has no item for personal care, and shows nights only for short-term accommodation', () => {
    const { unmount } = render(<Harness mode="edit" step="travel" initial={draftBlock(mondayWednesday('b1', { supportType: 'PersonalCare' }))} />)
    expect(screen.getByText(/Transport goes with community access and group activities\. Personal care has no transport item\./)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Accommodation nights' })).not.toBeInTheDocument()
    unmount()

    render(<Harness mode="edit" step="travel" initial={draftBlock(mondayWednesday('b1', { supportType: 'StaSupport', accommodation: { nights: 2, workerOnSite: true } }))} />)
    expect(screen.getByRole('heading', { name: 'Accommodation nights' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nights each shift')).toHaveValue(2)
    expect(screen.getByRole('checkbox', { name: 'A support worker must stay on site' })).toBeChecked()
  })
})

describe('PlanStepper Review step and saving', () => {
  it('adds a new block to the plan from the Review step, and not before', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness mode="new" step="review" onSave={onSave} />)

    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add to plan' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].block.id).toBe('b1')
  })

  it('cannot add a block that has problems, and says which', () => {
    render(<Harness mode="new" step="review" initial={draftBlock(mondayWednesday('b1', { days: [] }))} />)

    expect(screen.getByRole('button', { name: 'Add to plan' })).toBeDisabled()
    expect(screen.getByText('This block cannot be priced yet')).toBeInTheDocument()
    expect(screen.getByText('Choose at least one day.')).toBeInTheDocument()
  })

  it('has a Save block on the Review step of a block being changed, and a shortcut to it on the steps before, so a quick edit is not five clicks', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness mode="edit" step="times" onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: 'Thursday' }))
    await user.click(screen.getByRole('button', { name: 'Save block' }))
    expect(onSave.mock.calls[0][0].block.days).toEqual(['Monday', 'Wednesday', 'Thursday'])

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('button', { name: 'Save block' })).toHaveLength(1)
  })

  it('disables the Save block shortcut while the block has problems', () => {
    render(<Harness mode="edit" step="times" initial={draftBlock(mondayWednesday('b1', { days: [] }))} />)
    expect(screen.getByRole('button', { name: 'Save block' })).toBeDisabled()
  })

  it('names the form for the step, new or edit', () => {
    const { unmount } = render(<Harness mode="new" step="times" />)
    expect(screen.getByRole('form', { name: 'New block: Days and times' })).toBeInTheDocument()
    unmount()
    render(<Harness mode="edit" step="travel" />)
    expect(screen.getByRole('form', { name: 'Edit block: Travel and transport' })).toBeInTheDocument()
  })
})
