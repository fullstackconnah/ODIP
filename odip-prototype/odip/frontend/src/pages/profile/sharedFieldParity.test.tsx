/**
 * Drift guard: the Profile wizard must render each field captured at Intake as the SAME control the Intake wizard does
 * (same element, input type, attributes and, for dropdowns, the same options with the same human labels) — that is the
 * promise made when those fields became editable on the Profile wizard. Both wizards' step components are rendered
 * side by side (one after the other, so their shared ids do not collide) and their controls compared field by field.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import type { ParticipantFormData } from '@/lib/participantSchema'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { ParticipantDetailsStep } from '../intake/steps/ParticipantDetailsStep'
import { NdisFundingStep } from '../intake/steps/NdisFundingStep'
import { SupportNeedsStep } from '../intake/steps/SupportNeedsStep'
import { MedicalSummaryStep } from '../intake/steps/MedicalSummaryStep'
import { BehaviourSummaryStep } from '../intake/steps/BehaviourSummaryStep'
import { RisksHazardsStep } from '../intake/steps/RisksHazardsStep'
import { KeyIdentifiersStep } from './steps/KeyIdentifiersStep'
import { MedicalDetailStep } from './steps/MedicalDetailStep'
import { MobilityFunctionalStep } from './steps/MobilityFunctionalStep'
import { BehaviourCognitionStep } from './steps/BehaviourCognitionStep'

vi.mock('@/api/hooks', () => ({
  useParticipantContactRoles: () => ({ data: [], isLoading: false }),
  useDeleteContactRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const DEFAULTS = {
  fundingSource: 'Ndis', planType: 'SelfManaged', supportRatio: 'SharedSupport', overnightSupport: 'ActiveNight', overnightRatio: 'OneToOne',
  consents: [], healthConditions: [], riskEntries: [],
} as unknown as ParticipantFormData

/** Every Intake step that owns a shared field, in one form. */
function IntakeSteps() {
  const { control, register, formState: { errors } } = useForm<ParticipantFormData>({ defaultValues: DEFAULTS })
  const riskEntries = useFieldArray({ control, name: 'riskEntries' })
  const watched = useWatch({ control })
  return (
    <>
      <ParticipantDetailsStep control={control} register={register} errors={errors} livingArrangementValue={undefined} />
      <NdisFundingStep control={control} register={register} errors={errors} fundingSourceValue={watched.fundingSource} planTypeComplianceWarningValue={null} />
      <SupportNeedsStep control={control} register={register} errors={errors} overnightSupportValue={watched.overnightSupport} />
      <MedicalSummaryStep register={register} />
      <BehaviourSummaryStep control={control} register={register} />
      <RisksHazardsStep control={control} register={register} errors={errors} riskEntryFieldArray={riskEntries} />
    </>
  )
}

/** Every Profile step that owns a shared field, in one form, with the shared fields editable. */
function ProfileSteps() {
  const { control, register, formState: { errors } } = useForm<ParticipantFormData>({ defaultValues: DEFAULTS })
  const healthConditions = useFieldArray({ control, name: 'healthConditions' })
  const watched = useWatch({ control }) as Partial<ParticipantFormData>
  const participant = { id: 'participant-1' } as unknown as ParticipantDetailDto
  return (
    <>
      <KeyIdentifiersStep control={control} register={register} errors={errors} participant={participant} activeStaff={[]} sharedFieldsEditable />
      <MedicalDetailStep control={control} register={register} errors={errors} participant={participant} healthConditionFieldArray={healthConditions} watchedValues={watched} sharedFieldsEditable />
      <MobilityFunctionalStep control={control} register={register} participant={participant} errors={errors} sharedFieldsEditable />
      <BehaviourCognitionStep control={control} register={register} participant={participant} sharedFieldsEditable />
    </>
  )
}

const ATTRIBUTES = ['type', 'inputmode', 'maxlength', 'placeholder', 'rows', 'role', 'aria-haspopup']

/** What kind of control an element is: its tag plus the attributes that define how it behaves and what it invites. */
function signature(id: string): string {
  const el = document.getElementById(id)
  if (!el) return `MISSING #${id}`
  return [el.tagName.toLowerCase(), ...ATTRIBUTES.map((a) => `${a}=${el.getAttribute(a) ?? ''}`)].join(' ')
}

/** The options a custom Dropdown offers, as the user reads them. */
async function dropdownOptions(user: ReturnType<typeof userEvent.setup>, id: string): Promise<string[]> {
  await user.click(document.getElementById(id) as HTMLElement)
  // Scoped to the open listbox: the Profile steps also hold native <select>s, whose <option>s have the same role.
  const options = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent ?? '')
  await user.keyboard('{Escape}')
  return options
}

const TEXT_CONTROLS = [
  'firstName', 'lastName', 'preferredName', 'dateOfBirth', 'phone', 'email',
  'addressStreet', 'addressSuburb', 'addressPostcode',
  'ndisNumber', 'planStartDate', 'planEndDate',
  'medicalSummary', 'expressiveSkills', 'behaviourRiskSummary',
  'mobilityAidWheelchair', 'requiresHiLoBed', 'requiresHoist', 'requiresShowerChair', 'requiresCommode', 'requiresStandingMachine',
]
const DROPDOWNS = ['addressState', 'fundingSource', 'planType', 'supportRatio', 'overnightSupport', 'overnightRatio']

async function collect(Steps: () => React.JSX.Element) {
  const user = userEvent.setup()
  render(<Steps />)
  const signatures = Object.fromEntries([...TEXT_CONTROLS, ...DROPDOWNS].map((id) => [id, signature(id)]))
  const options: Record<string, string[]> = {}
  for (const id of DROPDOWNS) options[id] = await dropdownOptions(user, id)
  cleanup()
  return { signatures, options }
}

describe('Profile wizard shared fields render as the same controls as the Intake wizard', () => {
  it('every shared text/date/textarea/checkbox/dropdown control has the same element and attributes', async () => {
    const intake = await collect(IntakeSteps)
    const profile = await collect(ProfileSteps)

    for (const id of [...TEXT_CONTROLS, ...DROPDOWNS]) {
      expect(intake.signatures[id], `Intake has #${id}`).not.toMatch(/^MISSING/)
      expect(profile.signatures[id], `#${id}`).toBe(intake.signatures[id])
    }
  })

  it('every shared dropdown offers the same options with the same human labels (never raw enum text)', async () => {
    const intake = await collect(IntakeSteps)
    const profile = await collect(ProfileSteps)

    for (const id of DROPDOWNS) {
      expect(intake.options[id].length, `#${id} has options`).toBeGreaterThan(0)
      expect(profile.options[id], `#${id} options`).toEqual(intake.options[id])
    }
    expect(profile.options.planType).toEqual(['Self Managed', 'Plan Managed', 'Agency Managed'])
    expect(profile.options.supportRatio).toEqual(['Shared Support', '1:1', '1:2', '2:1', 'Other'])
    expect(profile.options.addressState[0]).toBe('Not specified')
  })
})
