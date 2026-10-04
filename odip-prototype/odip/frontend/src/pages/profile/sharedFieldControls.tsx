/**
 * The Profile wizard's EDITABLE controls for the fields captured at Intake (the "shared" fields of
 * PF-10.1's allocation contract). Staff sometimes find the intake answer was wrong, so the Profile
 * wizard no longer shows these read-only: each one is the same control, with the same placeholder,
 * options, human labels and validation (participantSchema.ts's per-step schemas run the Intake
 * refines), that the Intake wizard renders for it. The option lists come from `../intake/intakeOptions`
 * and the Yes/No toggle from `../intake/intakeHelpers`, both shared with the Intake steps, so the two
 * cannot drift; sharedFieldParity.test.tsx also renders both wizards' controls side by side.
 *
 * Every export renders grid children (each carries a `span.*` class, as formGridSpans.test.tsx requires)
 * for the caller to place inside its own `formGrid`. The public Caregiver wizard reuses the Profile
 * steps but never opts in to these — it keeps its read-only `ReadOnlyField`s.
 */
import type { ReactNode } from 'react'
import { Controller, useWatch } from 'react-hook-form'
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { TextAreaField } from '@/components/TextAreaField'
import { CheckboxField } from '@/components/CheckboxField'
import { useParticipantContactRoles } from '@/api/hooks'
import { planTypeComplianceWarning } from '@/api/types/contacts'
import type { PlanType, SupportRatio } from '@/api/types/enums'
import { OVERNIGHT_RATIO_LABELS } from '@/api/types/participants'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { span } from '@/lib/formGrid'
import { PlanTypeComplianceBanner, YesNoToggleField } from '../intake/intakeHelpers'
import { PlanBudgetCard } from '../funding/PlanBudgetCard'
import {
  ADDRESS_STATE_ITEMS, FUNDING_SOURCE_ITEMS, OVERNIGHT_RATIO_ITEMS, OVERNIGHT_SUPPORT_ITEMS, PLAN_TYPE_ITEMS,
  SUPPORT_RATIO_ITEMS, itemsIncludingCurrent,
} from '../intake/intakeOptions'
import { FROM_INTAKE_NOTE } from './profileFormat'

type Ctl = Control<ParticipantFormData>
type Reg = UseFormRegister<ParticipantFormData>
type Errs = FieldErrors<ParticipantFormData>

/** One line above a card's fields, saying they came from intake and may be corrected here. */
export function FromIntakeNote({ children }: { children?: ReactNode }) {
  return <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">{children ?? FROM_INTAKE_NOTE}</p>
}

/** Name, preferred name, date of birth, phone, email — Intake's "Personal Information" card. */
export function PersonalInformationFields({ register, errors }: { register: Reg; errors: Errs }) {
  return (
    <>
      <FormField label="First Name" required error={errors.firstName?.message} className={span.medium}>
        <input id="firstName" {...register('firstName')} placeholder="e.g. John" />
      </FormField>

      <FormField label="Last Name" required error={errors.lastName?.message} className={span.medium}>
        <input id="lastName" {...register('lastName')} placeholder="e.g. Smith" />
      </FormField>

      <FormField label="Preferred Name" className={span.medium}>
        <input id="preferredName" {...register('preferredName')} placeholder="e.g. Johnny" />
      </FormField>

      <FormField label="Date of Birth" className={span.date}>
        <input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
      </FormField>

      <FormField label="Phone" error={errors.phone?.message} className={span.medium}>
        <input id="phone" type="tel" {...register('phone')} placeholder="e.g. 0400 000 000" />
      </FormField>

      <FormField label="Email" error={errors.email?.message} className={span.medium}>
        <input id="email" type="email" {...register('email')} placeholder="e.g. name@example.com" />
      </FormField>
    </>
  )
}

/** Street, suburb, state, postcode — Intake's "Address" card. */
export function AddressFields({ control, register, errors }: { control: Ctl; register: Reg; errors: Errs }) {
  return (
    <>
      <FormField label="Street" className={span.long}>
        <input id="addressStreet" {...register('addressStreet')} placeholder="e.g. 12 Example Street" />
      </FormField>

      <FormField label="Suburb" className={span.medium}>
        <input id="addressSuburb" {...register('addressSuburb')} placeholder="e.g. Fortitude Valley" />
      </FormField>

      <FormField label="State" className={span.short}>
        <Controller
          control={control}
          name="addressState"
          render={({ field }) => (
            <Dropdown id="addressState" variant="form" value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} items={ADDRESS_STATE_ITEMS} />
          )}
        />
      </FormField>

      <FormField label="Postcode" error={errors.addressPostcode?.message} hint="4 digits, e.g. 4000" className={span.short}>
        <input id="addressPostcode" {...register('addressPostcode')} inputMode="numeric" maxLength={4} placeholder="e.g. 4000" />
      </FormField>
    </>
  )
}

/**
 * Funding source, NDIS number, plan dates and plan type — the shared half of Intake's "NDIS & Funding"
 * card, with the same rule: the NDIS number and plan fields are only asked for NDIS funding, and a
 * funding source of "Other" asks for the funding organisation instead (required by fundingSourceRefine).
 * Also shows Intake's advisory plan-type/contact-role banner, computed from the participant's saved
 * contacts (which the Contacts card beside it edits) against the plan type as currently selected.
 */
export function NdisFundingFields({ control, register, errors, participantId }: { control: Ctl; register: Reg; errors: Errs; participantId: string }) {
  const [fundingSource, planType] = useWatch({ control, name: ['fundingSource', 'planType'] })
  const { data: contactRoles, isLoading } = useParticipantContactRoles(participantId)
  const warning = isLoading || !contactRoles ? null : planTypeComplianceWarning(planType as PlanType | undefined, contactRoles)
  const showNdisFields = fundingSource !== 'Other'
  return (
    <>
      <FormField label="Funding Source" required error={errors.fundingSource?.message} className={span.medium}>
        <Controller
          control={control}
          name="fundingSource"
          render={({ field }) => (
            <Dropdown id="fundingSource" variant="form" value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} items={FUNDING_SOURCE_ITEMS} />
          )}
        />
      </FormField>

      {showNdisFields ? (
        <>
          <FormField label="NDIS Number" className={span.short}>
            <input id="ndisNumber" {...register('ndisNumber')} placeholder="e.g. 431234567" />
          </FormField>

          <FormField label="Plan Start Date" className={span.date}>
            <input id="planStartDate" type="date" {...register('planStartDate')} />
          </FormField>

          <FormField label="Plan End Date" className={span.date}>
            <input id="planEndDate" type="date" {...register('planEndDate')} />
          </FormField>

          <FormField label="Plan Type" required error={errors.planType?.message} className={span.short}>
            <Controller
              control={control}
              name="planType"
              render={({ field }) => (
                <Dropdown id="planType" variant="form" value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} items={PLAN_TYPE_ITEMS} />
              )}
            />
          </FormField>

          {warning && (
            <div className={span.long}>
              <PlanTypeComplianceBanner message={warning} />
            </div>
          )}

          {/* The plan budget, as at Intake: only for NDIS funding, and saved through the funding endpoints, never this wizard's per-step patch. */}
          <div className={span.long}>
            <PlanBudgetCard participantId={participantId} planType={(planType as PlanType | undefined) ?? 'SelfManaged'} />
          </div>
        </>
      ) : (
        <FormField label="Funding Organisation" required error={errors.fundingOrganisation?.message} className={span.medium}>
          <input id="fundingOrganisation" {...register('fundingOrganisation')} placeholder="e.g. Plan Partners" />
        </FormField>
      )}
    </>
  )
}

/** The four cultural-background flags — Intake's "Cultural Background" toggles. */
export function CulturalBackgroundFields({ control }: { control: Ctl }) {
  return (
    <>
      <div className={span.medium}><YesNoToggleField control={control} name="isCald" label="CALD" /></div>
      <div className={span.medium}><YesNoToggleField control={control} name="isLgbtqi" label="LGBTIQA+" /></div>
      <div className={span.medium}><YesNoToggleField control={control} name="isFamilyCommunity" label="Family / Community" /></div>
      <div className={span.medium}><YesNoToggleField control={control} name="isAboriginalOrTorresStraitIslander" label="Aboriginal and/or Torres Strait Islander" /></div>
    </>
  )
}

/** The five "information received" flags — Intake's "Information Received" toggles. */
export function InformationReceivedFields({ control }: { control: Ctl }) {
  return (
    <>
      <div className={span.medium}><YesNoToggleField control={control} name="receivedRightsAndResponsibilitiesInfo" label="Received: Rights and Responsibilities" /></div>
      <div className={span.medium}><YesNoToggleField control={control} name="receivedPrivacyAndConfidentialityInfo" label="Received: Privacy and Confidentiality" /></div>
      <div className={span.medium}><YesNoToggleField control={control} name="receivedFeedbackInfo" label="Received: Feedback Information and Form" /></div>
      <div className={span.medium}><YesNoToggleField control={control} name="receivedBeingSafeInfo" label="Received: Being Safe Information" /></div>
      <div className={span.medium}><YesNoToggleField control={control} name="receivedAdvocacyInfo" label="Received: Advocacy Information" /></div>
    </>
  )
}

/**
 * Wheelchair, overnight support and ratio, support ratio and the five equipment checkboxes — Intake's
 * "Support Needs" step. The overnight ratio is only asked when there is overnight support, as at Intake.
 * A stored support ratio the Intake list does not offer (1:3, 1:4, 1:5 are valid on the server) is kept as
 * an extra option, so it does not read as blank now that the field is editable.
 */
export function SupportNeedsFields({ control, register, errors }: { control: Ctl; register: Reg; errors: Errs }) {
  const [overnightSupport, supportRatio] = useWatch({ control, name: ['overnightSupport', 'supportRatio'] })
  const supportRatioItems = itemsIncludingCurrent(SUPPORT_RATIO_ITEMS, supportRatio, (value) => OVERNIGHT_RATIO_LABELS[value as SupportRatio])
  return (
    <>
      <CheckboxField label="Wheelchair" id="mobilityAidWheelchair" {...register('mobilityAidWheelchair')} className={span.short} />

      <FormField label="Overnight Support" className={span.medium}>
        <Controller
          control={control}
          name="overnightSupport"
          render={({ field }) => (
            <Dropdown id="overnightSupport" variant="form" value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} items={OVERNIGHT_SUPPORT_ITEMS} />
          )}
        />
      </FormField>

      {overnightSupport !== 'None' && (
        <FormField label="Overnight Ratio" className={span.medium}>
          <Controller
            control={control}
            name="overnightRatio"
            render={({ field }) => (
              <Dropdown id="overnightRatio" variant="form" value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} items={OVERNIGHT_RATIO_ITEMS} />
            )}
          />
        </FormField>
      )}

      <FormField label="Support Ratio" required error={errors.supportRatio?.message} className={span.medium}>
        <Controller
          control={control}
          name="supportRatio"
          render={({ field }) => (
            <Dropdown id="supportRatio" variant="form" value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} items={supportRatioItems} />
          )}
        />
      </FormField>

      <CheckboxField label="Hi-Lo Bed" id="requiresHiLoBed" {...register('requiresHiLoBed')} className={span.short} />
      <CheckboxField label="Hoist" id="requiresHoist" {...register('requiresHoist')} className={span.short} />
      <CheckboxField label="Shower Chair" id="requiresShowerChair" {...register('requiresShowerChair')} className={span.short} />
      <CheckboxField label="Commode" id="requiresCommode" {...register('requiresCommode')} className={span.short} />
      <CheckboxField label="Standing Machine" id="requiresStandingMachine" {...register('requiresStandingMachine')} className={span.short} />
    </>
  )
}

/** Behaviours-of-concern flags, expressive skills and behaviour risk summary — Intake's behaviour and risks steps. */
export function BehaviourSummaryFields({ control, register }: { control: Ctl; register: Reg }) {
  return (
    <>
      <div className={span.medium}><YesNoToggleField control={control} name="behavioursOfConcernCurrent" label="Behaviours of Concern (Current)" /></div>
      <div className={span.medium}><YesNoToggleField control={control} name="behavioursOfConcernFiveYearHistory" label="Behaviours of Concern (5-Year History)" /></div>
      <TextAreaField label="Expressive Skills" id="expressiveSkills" {...register('expressiveSkills')} rows={2} placeholder="e.g. High, verbal..." className={span.long} />
      <TextAreaField label="Behaviour Risk Summary" id="behaviourRiskSummary" {...register('behaviourRiskSummary')} rows={3} placeholder="Behaviour risk notes..." className={span.long} />
    </>
  )
}

/** The free-text medical summary — Intake's "Medical Summary" step. */
export function MedicalSummaryField({ register }: { register: Reg }) {
  return (
    <TextAreaField label="Medical Summary" id="medicalSummary" {...register('medicalSummary')} rows={3} placeholder="Medical information..." className={span.long} />
  )
}
