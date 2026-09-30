/**
 * Guard for the 12-column form grid (lib/formGrid.ts). At `xl` (>= 1280px) `formGrid` is 12 tracks, so a direct child
 * with no `xl:col-span-*` class occupies ONE of them: about 49px at 1440px and 98px at 1920px. Every editable field is
 * given `span.short|medium|long`, but the Profile wizard's read-only fields (ReadOnlyField / ReadOnlyGroupField) took no
 * span, so 38 of them shipped as a column of 49-98px wide inputs that showed "Ale" for "Alexandra" (only at >= 1280px,
 * which is why nothing else caught it). jsdom does no layout, so this pins the cause: every direct child of every
 * formGrid container in every Profile step, and in the public Caregiver wizard that renders the same steps, carries an
 * `xl:col-span-*` class. A future un-spanned child fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { useFieldArray, useForm } from 'react-hook-form'
import type { ParticipantFormData } from '@/lib/participantSchema'
import type { ParticipantDetailDto } from '@/api/types/participants'
import type { CaregiverFormDto } from '@/api/types/caregiver'
import { formGrid, span } from '@/lib/formGrid'
import { ReadOnlyField, ReadOnlyGroupField } from './profileHelpers'
import { KeyIdentifiersStep } from './steps/KeyIdentifiersStep'
import { BehaviourCognitionStep } from './steps/BehaviourCognitionStep'
import { CulturalDepthConsentsStep } from './steps/CulturalDepthConsentsStep'
import { MedicalDetailStep } from './steps/MedicalDetailStep'
import { MobilityFunctionalStep } from './steps/MobilityFunctionalStep'
import { DailyLivingStep } from './steps/DailyLivingStep'
import { CommunityAccessStep } from './steps/CommunityAccessStep'

const { mockUsePublicCaregiverForm } = vi.hoisted(() => ({ mockUsePublicCaregiverForm: vi.fn() }))
vi.mock('@/api/hooks/caregiver', () => ({
  usePublicCaregiverForm: mockUsePublicCaregiverForm,
  useSaveCaregiverDraft: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useSubmitCaregiverForm: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
}))
import CaregiverWizardPage from '../caregiver/CaregiverWizardPage'

// ── the guard itself ─────────────────────────────────────────────────────────────────────────────────────────────────

const GRID_CLASSES = formGrid.split(/\s+/)
const XL_SPAN = /(^|\s)xl:col-span-\d+(\s|$)/

/** Elements carrying every class `formGrid` is made of (so `modalGrid` and unrelated grids are not swept in). */
function formGridContainers(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('div')].filter((el) => GRID_CLASSES.every((c) => el.classList.contains(c)))
}

/** A short description of every direct child of a formGrid container that has no `xl:col-span-*` class. */
function unspannedChildren(root: ParentNode): string[] {
  const bad: string[] = []
  for (const grid of formGridContainers(root)) {
    for (const child of Array.from(grid.children)) {
      if (!XL_SPAN.test(child.getAttribute('class') ?? '')) {
        const id = child.id || child.querySelector('[id]')?.id
        bad.push(`<${child.tagName.toLowerCase()}${id ? ` #${id}` : ''}> ${(child.textContent ?? '').trim().slice(0, 40)}`)
      }
    }
  }
  return bad
}

describe('formGrid children guard (the guard itself)', () => {
  it('flags a direct child with no xl:col-span-* class, and accepts one that has it', () => {
    const { container, rerender } = render(
      <div className={formGrid}>
        <div id="a">bare</div>
      </div>,
    )
    expect(formGridContainers(container)).toHaveLength(1)
    expect(unspannedChildren(container)).toEqual(['<div #a> bare'])
    rerender(
      <div className={formGrid}>
        <div id="a" className={span.short}>spanned</div>
      </div>,
    )
    expect(unspannedChildren(container)).toEqual([])
  })

  it('does not treat a modalGrid, or a non-grid div, as a formGrid container', () => {
    const { container } = render(
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2"><div>half</div></div>
        <div className="flex"><div>flex child</div></div>
      </>,
    )
    expect(formGridContainers(container)).toHaveLength(0)
  })
})

// ── ReadOnlyField / ReadOnlyGroupField take a span ───────────────────────────────────────────────────────────────────

describe('ReadOnlyField and ReadOnlyGroupField', () => {
  it('forward className to their grid item, so the caller can give it a span', () => {
    const { container } = render(
      <div className={formGrid}>
        <ReadOnlyField field="firstName" label="First Name" value="Alexandra" className={span.medium} />
        <ReadOnlyGroupField field="contactRoles" label="Contacts" className={span.long}>Managed elsewhere.</ReadOnlyGroupField>
      </div>,
    )
    const [field, group] = Array.from(container.querySelector('div')!.children)
    expect(field).toHaveClass('md:col-span-1', 'xl:col-span-6')
    expect(group).toHaveClass('md:col-span-2', 'xl:col-span-12')
    expect(unspannedChildren(container)).toEqual([])
  })
})

// ── every Profile step ───────────────────────────────────────────────────────────────────────────────────────────────

type StepName = 'keyIdentifiers' | 'behaviourCognition' | 'culturalDepth' | 'medical' | 'mobility' | 'dailyLiving' | 'communityAccess'

/** Renders one Profile step against a real react-hook-form instance, the way ProfileWizardPage does. */
function StepHarness({ step }: { step: StepName }) {
  const { control, register, watch, formState: { errors } } = useForm<ParticipantFormData>({
    defaultValues: { consents: [], healthConditions: [], adlAssessments: [], checklistItems: [], communityAccessRiskItems: [] },
  })
  const consents = useFieldArray({ control, name: 'consents' })
  const healthConditions = useFieldArray({ control, name: 'healthConditions' })
  const adl = useFieldArray({ control, name: 'adlAssessments' })
  const checklist = useFieldArray({ control, name: 'checklistItems' })
  const riskItems = useFieldArray({ control, name: 'communityAccessRiskItems' })
  const watched = watch()
  const participant = { firstName: 'Alexandra', lastName: 'Citizen-Smith', overnightSupport: 'Sleepover', overnightRatio: '1:1', supportRatio: '1:2' } as unknown as ParticipantDetailDto
  switch (step) {
    case 'keyIdentifiers':
      return <KeyIdentifiersStep control={control} register={register} errors={errors} participant={participant} activeStaff={[]} />
    case 'behaviourCognition':
      return <BehaviourCognitionStep control={control} register={register} participant={participant} />
    case 'culturalDepth':
      return <CulturalDepthConsentsStep control={control} register={register} participant={participant} consentsFieldArray={consents} staVisible />
    case 'medical':
      return <MedicalDetailStep control={control} register={register} errors={errors} participant={participant} healthConditionFieldArray={healthConditions} watchedValues={watched} />
    case 'mobility':
      return <MobilityFunctionalStep control={control} register={register} participant={participant} />
    case 'dailyLiving':
      return <DailyLivingStep control={control} register={register} adlFieldArray={adl} watchedValues={watched} caVisible />
    case 'communityAccess':
      return <CommunityAccessStep control={control} register={register} checklistFieldArray={checklist} riskItemsFieldArray={riskItems} watchedValues={watched} />
  }
}

describe('every Profile step: each direct child of a formGrid container carries an xl:col-span-* class', () => {
  const STEPS: { step: StepName; readOnlyFields: number }[] = [
    { step: 'keyIdentifiers', readOnlyFields: 16 },
    { step: 'behaviourCognition', readOnlyFields: 4 },
    { step: 'culturalDepth', readOnlyFields: 9 },
    { step: 'medical', readOnlyFields: 1 }, // sits in a Card, not a formGrid
    { step: 'mobility', readOnlyFields: 9 },
    { step: 'dailyLiving', readOnlyFields: 0 },
    { step: 'communityAccess', readOnlyFields: 0 },
  ]

  it.each(STEPS)('$step', ({ step, readOnlyFields }) => {
    const { container } = render(<StepHarness step={step} />)
    // A step with no grid at all would pass vacuously: the four read-only-heavy steps must actually render grids.
    if (readOnlyFields > 1) expect(formGridContainers(container).length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[aria-readonly="true"]')).toHaveLength(readOnlyFields)
    expect(unspannedChildren(container)).toEqual([])
  })

  it('gives every read-only field of the four steps that had none a span its content fits', () => {
    // Spot-check the mapping: names take a medium span, Yes/No flags a short one, the contacts note a full row.
    const { container } = render(<StepHarness step="keyIdentifiers" />)
    const spanOf = (id: string) => container.querySelector(`#${id}`)!.closest('[class*="col-span"]')!
    expect(spanOf('firstName')).toHaveClass('xl:col-span-6')
    expect(spanOf('addressPostcode')).toHaveClass('xl:col-span-3')
    expect(spanOf('addressStreet')).toHaveClass('xl:col-span-12')
    expect(spanOf('contactRoles')).toHaveClass('xl:col-span-12')
  })
})

// ── the public Caregiver wizard renders the same steps ───────────────────────────────────────────────────────────────

function makeDto(): CaregiverFormDto {
  return {
    status: 'Draft', caregiverName: null, caregiverRelationship: null, expiresAt: '2030-01-01T00:00:00Z', rejectionNote: null,
    current: { firstName: 'Sophie', lastName: 'Rivers', ndisNumber: '431234567', mobilityAidWheelchair: true },
    editable: [], draft: null,
  }
}

describe('Caregiver wizard: no un-spanned child of a formGrid on any step', () => {
  beforeEach(() => {
    mockUsePublicCaregiverForm.mockReset()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
  })

  it('About You, then every step it walks through with Next', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([{ path: '/caregiver/:token', element: <CaregiverWizardPage /> }], { initialEntries: ['/caregiver/tok-1'] })
    const { container } = render(<RouterProvider router={router} />)

    await screen.findByLabelText(/^your name/i)
    expect(formGridContainers(container).length).toBeGreaterThan(0)
    expect(unspannedChildren(container)).toEqual([])

    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    const next = () => user.click(within(container).getByRole('button', { name: /^next$/i }))

    // Key Identifiers (16 read-only identity fields), Cultural Depth, Medical, Mobility, Behaviour, Daily Living: each step is
    // recognised by a field only it has, so a slow Next never lets the loop assert against the previous step's DOM.
    const arrived = [/medicare number/i, /personal interests/i, /primary diagnosis/i, /mobility notes/i]
    const seenReadOnly: number[] = []
    for (let i = 0; i < 6; i++) {
      await next()
      if (i < arrived.length) await screen.findByLabelText(arrived[i])
      else await screen.findByText(i === 4 ? /behaviour summary/i : /activities of daily living/i)
      seenReadOnly.push(container.querySelectorAll('[aria-readonly="true"]').length)
      expect(unspannedChildren(container), `step ${i + 2}`).toEqual([])
    }
    // The four read-only-heavy steps really were rendered on the way (16 + 9 + 1 + 9 + 4 read-only fields), so this was not vacuous.
    expect(seenReadOnly.reduce((a, b) => a + b, 0)).toBe(16 + 9 + 1 + 9 + 4)
  })
})
