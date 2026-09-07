import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useWatch, Controller, type Resolver, type FieldErrors } from 'react-hook-form'
import { z } from 'zod'
import type { AxiosError } from 'axios'
import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { useCreateMedication, useUpdateMedication, useMedication, useParticipant } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { FormField, labelClass } from '@/components/FormField'
import { Card } from '@/components/Card'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { MEDICATION_FORMS, MEDICATION_ROUTES, DRUG_SCHEDULES, MEDICATION_SUPPORT_LEVELS, MEDICATION_STATUSES, PACKAGING_TYPES, MEDICATION_FREQUENCIES, WEEKDAYS } from '@/api/types/enums'
import type { MedicationForm, MedicationRoute, Weekday } from '@/api/types/enums'
import { FORM_LABELS, ROUTE_LABELS, DRUG_SCHEDULE_LABELS, SUPPORT_LEVEL_LABELS, MEDICATION_STATUS_LABELS, PACKAGING_LABELS, FREQUENCY_LABELS, WEEKDAY_LABELS } from '@/api/types/medications'
import type { CreateMedicationDto, UpdateMedicationDto } from '@/api/types/medications'
import { formatDateAu } from '@/lib/utils'

// Which medication forms make clinical sense for a given administration route. Used only to
// surface a soft warning when the two fields disagree — the currently selected form is never
// cleared automatically (see the inline warning under the Form field below).
const ROUTE_FORM_MAP: Record<MedicationRoute, MedicationForm[]> = {
  Oral: ['Tablet', 'Capsule', 'Liquid', 'Powder', 'Other'],
  Subcutaneous: ['Injection', 'Other'],
  Intramuscular: ['Injection', 'Other'],
  Topical: ['Cream', 'Patch', 'Other'],
  Inhaled: ['Inhaler', 'Other'],
  Enteral: ['Liquid', 'Powder', 'Other'],
  Rectal: ['Suppository', 'Other'],
  Sublingual: ['Tablet', 'Drops', 'Other'],
  Ocular: ['Drops', 'Other'],
  Nasal: ['Drops', 'Other'],
  Other: [...MEDICATION_FORMS],
}

const medicationSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  strength: z.string().optional(),
  form: z.string().min(1, 'Form is required'),
  route: z.string().min(1, 'Route is required'),
  packaging: z.string().min(1, 'Packaging is required'),
  doseDescription: z.string().min(1, 'Dose description is required — e.g. 1 tablet (500mg)'),
  directions: z.string().optional(),
  type: z.string().min(1),
  timesOfDayList: z.array(z.string()).optional(),
  frequency: z.string().min(1),
  daysOfWeek: z.array(z.string()).optional(),
  intervalDays: z.string().optional(),
  anchorDate: z.string().optional(),
  prnIndication: z.string().optional(),
  prnMaxDosesPer24h: z.string().optional(),
  prnMinIntervalMinutes: z.string().optional(),
  purpose: z.string().optional(),
  isHighRisk: z.boolean().optional(),
  isPsychotropic: z.boolean().optional(),
  isChemicalRestraint: z.boolean().optional(),
  bspInPlace: z.boolean().optional(),
  restrictivePracticeAuthorisationRef: z.string().optional(),
  isHighIntensitySupport: z.boolean().optional(),
  drugSchedule: z.string().min(1),
  supportLevel: z.string().min(1),
  prescriberName: z.string().optional(),
  pharmacyName: z.string().optional(),
  pharmacyPhone: z.string().optional(),
  consentObtained: z.boolean().optional(),
  consentGivenBy: z.string().optional(),
  consentDate: z.string().optional(),
  storageRequirements: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  nextReviewDue: z.string().optional(),
  notes: z.string().optional(),
  status: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.type === 'Prn' && (!data.prnIndication || !data.prnIndication.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prnIndication'], message: 'Required for PRN medications' })
  }
  if (data.type === 'Regular' && data.frequency === 'SpecificDays' && !(data.daysOfWeek?.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['daysOfWeek'], message: 'Select at least one day of the week' })
  }
  if (data.type === 'Regular' && data.frequency === 'EveryNDays') {
    if (!data.intervalDays || !data.intervalDays.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intervalDays'], message: 'Required for an every-N-days schedule' })
    }
    if (!data.anchorDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['anchorDate'], message: 'Required for an every-N-days schedule' })
    }
  }
  if (data.consentObtained) {
    if (!data.consentGivenBy || !data.consentGivenBy.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['consentGivenBy'], message: 'Required when consent is obtained' })
    }
    if (!data.consentDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['consentDate'], message: 'Required when consent is obtained' })
    }
  }
})

type MedicationFormData = z.infer<typeof medicationSchema>

// @hookform/resolvers 3.x's zodResolver reads ZodError.errors (a getter zod v4 removed in
// favour of .issues), so it throws past react-hook-form instead of populating
// formState.errors on validation failure. Resolve directly against zod's safeParse/.issues
// API instead of routing through that resolver.
const medicationResolver: Resolver<MedicationFormData> = (values) => {
  const result = medicationSchema.safeParse(values)
  if (result.success) return { values: result.data, errors: {} }
  const errors: FieldErrors<MedicationFormData> = {}
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]) as keyof MedicationFormData
    if (!errors[field]) errors[field] = { type: issue.code, message: issue.message }
  }
  return { values: {}, errors }
}

function extractMedicationErrorMessage(err: unknown, isEdit: boolean): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return (
    axiosErr?.response?.data?.errors?.[0] ||
    axiosErr?.response?.data?.message ||
    `Failed to ${isEdit ? 'update' : 'create'} medication. Please check your input and try again.`
  )
}

export default function MedicationFormPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const participantIdParam = searchParams.get('participantId')
  const isEdit = !!id
  const createMedication = useCreateMedication()
  const updateMedication = useUpdateMedication()
  const { data: existing, isLoading: isLoadingExisting } = useMedication(isEdit ? id : undefined)
  const participantId = isEdit ? existing?.participantId : participantIdParam
  const { data: participant } = useParticipant(participantId ?? undefined)
  const mutation = isEdit ? updateMedication : createMedication

  const [newTime, setNewTime] = useState('08:00')

  const { register, handleSubmit, reset, control, formState: { errors, isDirty } } = useForm<MedicationFormData>({
    resolver: medicationResolver,
    defaultValues: {
      form: 'Tablet',
      route: 'Oral',
      packaging: 'OriginalPackaging',
      type: 'Regular',
      timesOfDayList: [],
      frequency: 'Daily',
      daysOfWeek: [],
      drugSchedule: 'Unscheduled',
      supportLevel: 'SelfAdministered',
      isHighRisk: false,
      isPsychotropic: false,
      isChemicalRestraint: false,
      bspInPlace: false,
      isHighIntensitySupport: false,
      consentObtained: false,
      status: 'Active',
    },
  })

  const typeValue = useWatch({ control, name: 'type' })
  const frequencyValue = useWatch({ control, name: 'frequency' })
  const intervalDaysValue = useWatch({ control, name: 'intervalDays' })
  const anchorDateValue = useWatch({ control, name: 'anchorDate' })
  const routeValue = useWatch({ control, name: 'route' })
  const formValue = useWatch({ control, name: 'form' })
  const isPsychotropic = useWatch({ control, name: 'isPsychotropic' })
  const isChemicalRestraint = useWatch({ control, name: 'isChemicalRestraint' })
  const consentObtained = useWatch({ control, name: 'consentObtained' })

  const compatibleForms = ROUTE_FORM_MAP[routeValue as MedicationRoute] ?? [...MEDICATION_FORMS]
  const formMismatch = !!routeValue && !!formValue && !compatibleForms.includes(formValue as MedicationForm)
  const formOptions = formMismatch ? [...compatibleForms, formValue as MedicationForm] : compatibleForms

  useEffect(() => {
    if (existing) {
      reset({
        name: existing.name ?? '',
        strength: existing.strength ?? '',
        form: existing.form ?? 'Tablet',
        route: existing.route ?? 'Oral',
        packaging: existing.packaging ?? 'OriginalPackaging',
        doseDescription: existing.doseDescription ?? '',
        directions: existing.directions ?? '',
        type: existing.type ?? 'Regular',
        timesOfDayList: existing.timesOfDay ? existing.timesOfDay.split(',').filter(Boolean) : [],
        frequency: existing.frequency ?? 'Daily',
        daysOfWeek: existing.daysOfWeek ?? [],
        intervalDays: existing.intervalDays != null ? String(existing.intervalDays) : '',
        anchorDate: existing.anchorDate ?? '',
        prnIndication: existing.prnIndication ?? '',
        prnMaxDosesPer24h: existing.prnMaxDosesPer24h != null ? String(existing.prnMaxDosesPer24h) : '',
        prnMinIntervalMinutes: existing.prnMinIntervalMinutes != null ? String(existing.prnMinIntervalMinutes) : '',
        purpose: existing.purpose ?? '',
        isHighRisk: existing.isHighRisk ?? false,
        isPsychotropic: existing.isPsychotropic ?? false,
        isChemicalRestraint: existing.isChemicalRestraint ?? false,
        bspInPlace: existing.bspInPlace ?? false,
        restrictivePracticeAuthorisationRef: existing.restrictivePracticeAuthorisationRef ?? '',
        isHighIntensitySupport: existing.isHighIntensitySupport ?? false,
        drugSchedule: existing.drugSchedule ?? 'Unscheduled',
        supportLevel: existing.supportLevel ?? 'SelfAdministered',
        prescriberName: existing.prescriberName ?? '',
        pharmacyName: existing.pharmacyName ?? '',
        pharmacyPhone: existing.pharmacyPhone ?? '',
        consentObtained: existing.consentObtained ?? false,
        consentGivenBy: existing.consentGivenBy ?? '',
        consentDate: existing.consentDate ? existing.consentDate.split('T')[0] : '',
        storageRequirements: existing.storageRequirements ?? '',
        startDate: existing.startDate ? existing.startDate.split('T')[0] : '',
        endDate: existing.endDate ? existing.endDate.split('T')[0] : '',
        nextReviewDue: existing.nextReviewDue ? existing.nextReviewDue.split('T')[0] : '',
        notes: existing.notes ?? '',
        status: existing.status ?? 'Active',
      })
    }
  }, [existing, reset])

  const onSubmit = async (data: MedicationFormData) => {
    const payload: CreateMedicationDto = {
      name: data.name,
      strength: data.strength || undefined,
      form: data.form as CreateMedicationDto['form'],
      route: data.route as CreateMedicationDto['route'],
      packaging: data.packaging as CreateMedicationDto['packaging'],
      doseDescription: data.doseDescription,
      directions: data.directions || undefined,
      type: data.type as CreateMedicationDto['type'],
      timesOfDay: data.type === 'Regular' && data.timesOfDayList?.length ? data.timesOfDayList.join(',') : undefined,
      frequency: (data.type === 'Regular' ? data.frequency : 'Daily') as CreateMedicationDto['frequency'],
      daysOfWeek: data.type === 'Regular' && data.frequency === 'SpecificDays' ? (data.daysOfWeek as Weekday[] ?? []) : [],
      intervalDays: data.type === 'Regular' && data.frequency === 'EveryNDays' && data.intervalDays ? Number(data.intervalDays) : undefined,
      anchorDate: data.type === 'Regular' && data.frequency === 'EveryNDays' ? (data.anchorDate || undefined) : undefined,
      prnIndication: data.type === 'Prn' ? (data.prnIndication || undefined) : undefined,
      prnMaxDosesPer24h: data.type === 'Prn' && data.prnMaxDosesPer24h ? Number(data.prnMaxDosesPer24h) : undefined,
      prnMinIntervalMinutes: data.type === 'Prn' && data.prnMinIntervalMinutes ? Number(data.prnMinIntervalMinutes) : undefined,
      purpose: data.purpose || undefined,
      isHighRisk: data.isHighRisk ?? false,
      isPsychotropic: data.isPsychotropic ?? false,
      isChemicalRestraint: data.isChemicalRestraint ?? false,
      bspInPlace: data.bspInPlace ?? false,
      restrictivePracticeAuthorisationRef: data.restrictivePracticeAuthorisationRef || undefined,
      isHighIntensitySupport: data.isHighIntensitySupport ?? false,
      drugSchedule: data.drugSchedule as CreateMedicationDto['drugSchedule'],
      supportLevel: data.supportLevel as CreateMedicationDto['supportLevel'],
      prescriberName: data.prescriberName || undefined,
      pharmacyName: data.pharmacyName || undefined,
      pharmacyPhone: data.pharmacyPhone || undefined,
      consentObtained: data.consentObtained ?? false,
      consentGivenBy: data.consentObtained ? (data.consentGivenBy || undefined) : undefined,
      consentDate: data.consentObtained ? (data.consentDate || undefined) : undefined,
      storageRequirements: data.storageRequirements || undefined,
      startDate: data.startDate || undefined,
      endDate: data.endDate || undefined,
      nextReviewDue: data.nextReviewDue || undefined,
      notes: data.notes || undefined,
    }

    try {
      if (isEdit) {
        const updatePayload: UpdateMedicationDto = { ...payload, status: (data.status || 'Active') as UpdateMedicationDto['status'] }
        const res = await updateMedication.mutateAsync({ id: id!, data: updatePayload })
        if (res.success) {
          flushSync(() => reset(data))
          navigate(`/participants/${existing?.participantId}?tab=medications`)
        }
      } else if (participantId) {
        const res = await createMedication.mutateAsync({ participantId, data: payload })
        if (res.success) {
          flushSync(() => reset(data))
          navigate(`/participants/${participantId}?tab=medications`)
        }
      }
    } catch {
      // error handled by mutation state
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  if (isEdit && isLoadingExisting) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>
  if (!isEdit && !participantIdParam) return <div className="text-center py-12 text-[var(--color-muted-foreground)]">A participant is required to add a medication. Go to a participant's Medications tab to add one.</div>

  const backTo = isEdit ? `/participants/${existing?.participantId}?tab=medications` : `/participants/${participantIdParam}?tab=medications`

  return (
    <div className="space-y-6 animate-fade-in">
      {unsavedChangesDialog}
      <div className="flex items-center gap-4">
        <Link to={backTo} className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl md:text-2xl font-bold">{isEdit ? 'Edit Medication' : 'New Medication'}</h1>
          {participant && <p className="text-sm text-[var(--color-muted-foreground)]">{participant.fullName}</p>}
        </div>
      </div>

      {mutation.isError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {extractMedicationErrorMessage(mutation.error, isEdit)}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-6">
        {/* Medication */}
        <Card title="Medication" className="space-y-4 md:col-span-2">
          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label="Name" required error={errors.name?.message}>
              <input {...register('name')} placeholder="e.g. Paracetamol" autoFocus />
            </FormField>
            <FormField label="Strength">
              <input {...register('strength')} placeholder="e.g. 500mg" />
            </FormField>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <FormField label="Form" required error={errors.form?.message}>
                <Controller
                  control={control}
                  name="form"
                  render={({ field }) => (
                    <Dropdown
                      variant="form"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      items={formOptions.map(f => ({ value: f, label: FORM_LABELS[f] }))}
                    />
                  )}
                />
              </FormField>
              {formMismatch && (
                <p className="text-xs text-[var(--color-on-warning-container)] mt-1.5">Unusual form for this route — check the prescription</p>
              )}
            </div>
            <FormField label="Route" required error={errors.route?.message}>
              <Controller
                control={control}
                name="route"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={MEDICATION_ROUTES.map(r => ({ value: r, label: ROUTE_LABELS[r] }))}
                  />
                )}
              />
            </FormField>
          </div>
          <FormField label="Packaging" required error={errors.packaging?.message}>
            <Controller
              control={control}
              name="packaging"
              render={({ field }) => (
                <Dropdown
                  variant="form"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  items={PACKAGING_TYPES.map(p => ({ value: p, label: PACKAGING_LABELS[p] }))}
                />
              )}
            />
          </FormField>
          <FormField label="Dose Description" required error={errors.doseDescription?.message}>
            <input {...register('doseDescription')} placeholder="e.g. 1 tablet" />
          </FormField>
          <FormField label="Directions">
            <textarea {...register('directions')} rows={2} placeholder="e.g. Take with food" />
          </FormField>
        </Card>

        {/* Schedule */}
        <Card title="Schedule" className="space-y-4">
          <FormField label="Type" required>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <ToggleGroup
                  options={[{ key: 'Regular', label: 'Regular' }, { key: 'Prn', label: 'PRN (as needed)' }]}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>

          {typeValue === 'Regular' ? (
            <>
            <Controller
              control={control}
              name="timesOfDayList"
              render={({ field }) => {
                const times: string[] = field.value ?? []
                return (
                  <div>
                    <span className={labelClass}>Times of day</span>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {times.map(t => (
                        <span key={t} className="inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)]">
                          {t}
                          <button
                            type="button"
                            onClick={() => field.onChange(times.filter(x => x !== t))}
                            className="rounded-full hover:bg-[var(--color-border)] p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                            aria-label={`Remove ${t}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {times.length === 0 && <span className="text-sm text-[var(--color-muted-foreground)]">No times added yet</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} className="px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]" />
                      <button
                        type="button"
                        onClick={() => {
                          if (newTime && !times.includes(newTime)) field.onChange([...times, newTime].sort())
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-accent)] transition-colors"
                      >
                        <Plus className="w-4 h-4" /> Add
                      </button>
                    </div>
                  </div>
                )
              }}
            />

            <FormField label="Frequency" required>
              <Controller
                control={control}
                name="frequency"
                render={({ field }) => (
                  <ToggleGroup
                    options={MEDICATION_FREQUENCIES.map(f => ({ key: f, label: FREQUENCY_LABELS[f] }))}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </FormField>

            {frequencyValue === 'SpecificDays' && (
              <Controller
                control={control}
                name="daysOfWeek"
                render={({ field }) => {
                  const selected: string[] = field.value ?? []
                  return (
                    <FormField label="Days of week" required error={errors.daysOfWeek?.message}>
                      <div className="flex flex-wrap gap-2">
                        {WEEKDAYS.map(day => {
                          const active = selected.includes(day)
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => field.onChange(active ? selected.filter(d => d !== day) : [...selected, day])}
                              aria-pressed={active}
                              className={`min-h-[44px] min-w-[44px] flex items-center justify-center px-3 py-2 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 ${
                                active
                                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                                  : 'border-[var(--color-border)] hover:bg-[var(--color-accent)]'
                              }`}
                            >
                              {WEEKDAY_LABELS[day]}
                            </button>
                          )
                        })}
                      </div>
                    </FormField>
                  )
                }}
              />
            )}

            {frequencyValue === 'EveryNDays' && (
              <div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <FormField label="Every N days" required error={errors.intervalDays?.message}>
                    <input type="number" min="1" step="1" {...register('intervalDays')} placeholder="e.g. 2" />
                  </FormField>
                  <FormField label="Starting from" required error={errors.anchorDate?.message}>
                    <input type="date" {...register('anchorDate')} />
                  </FormField>
                </div>
                {intervalDaysValue && Number(intervalDaysValue) > 0 && anchorDateValue && (
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-2">
                    Due every {intervalDaysValue} day{Number(intervalDaysValue) === 1 ? '' : 's'}, starting {formatDateAu(anchorDateValue)}.
                  </p>
                )}
              </div>
            )}
            </>
          ) : (
            <>
              <FormField label="PRN Indication" required error={errors.prnIndication?.message} hint={!errors.prnIndication ? 'What symptom or situation should prompt this dose?' : undefined}>
                <textarea {...register('prnIndication')} rows={2} placeholder="e.g. Pain rated above 5/10" />
              </FormField>
              <div className="grid sm:grid-cols-2 gap-4">
                <FormField label="Max doses / 24h">
                  <input type="number" min="0" {...register('prnMaxDosesPer24h')} placeholder="e.g. 4" />
                </FormField>
                <FormField label="Min interval (minutes)">
                  <input type="number" min="0" {...register('prnMinIntervalMinutes')} placeholder="e.g. 240" />
                </FormField>
              </div>
            </>
          )}
        </Card>

        {/* Clinical & compliance */}
        <Card title="Clinical & compliance" className="space-y-4">
          <FormField label="Purpose">
            <textarea {...register('purpose')} rows={2} placeholder="What this medication is for" />
          </FormField>

          <FormField label="High Risk" layout="checkbox" hint="Requires a witness for every administered dose">
            <input type="checkbox" {...register('isHighRisk')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="High Intensity Support" layout="checkbox" hint="Administering this medication is an NDIS High Intensity support — staff must hold the relevant training.">
            <input type="checkbox" {...register('isHighIntensitySupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="Psychotropic" layout="checkbox">
            <input type="checkbox" {...register('isPsychotropic')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          {isPsychotropic && (
            <div className="rounded-lg border border-[var(--color-warning-container)] bg-[var(--color-warning-container)]/40 px-3 py-2 space-y-3">
              <FormField label="Chemical Restraint" layout="checkbox">
                <input type="checkbox" {...register('isChemicalRestraint')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>

              {isChemicalRestraint && (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--color-on-warning-container)]">
                    A medication used primarily to influence behaviour is a regulated restrictive practice — it must be in a current
                    behaviour support plan and authorised in your state or territory. Unauthorised use is a reportable incident.
                  </p>
                  <FormField label="Behaviour Support Plan in place" layout="checkbox">
                    <input type="checkbox" {...register('bspInPlace')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                  </FormField>
                  <FormField label="Restrictive Practice Authorisation Reference">
                    <input {...register('restrictivePracticeAuthorisationRef')} placeholder="Authorisation reference #" />
                  </FormField>
                </div>
              )}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label="Drug Schedule" required>
              <Controller
                control={control}
                name="drugSchedule"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={DRUG_SCHEDULES.map(s => ({ value: s, label: DRUG_SCHEDULE_LABELS[s] }))}
                  />
                )}
              />
            </FormField>
            <FormField label="Support Level" required>
              <Controller
                control={control}
                name="supportLevel"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={MEDICATION_SUPPORT_LEVELS.map(s => ({ value: s, label: SUPPORT_LEVEL_LABELS[s] }))}
                  />
                )}
              />
            </FormField>
          </div>

          {isEdit && (
            <FormField label="Status">
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value ?? 'Active'}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={MEDICATION_STATUSES.map(s => ({
                      value: s,
                      label: MEDICATION_STATUS_LABELS[s],
                      description: s === 'Ceased' ? 'Records are retained for approximately 7 years after ceasing.' : undefined,
                    }))}
                  />
                )}
              />
            </FormField>
          )}
        </Card>

        {/* Prescriber & supply */}
        <Card title="Prescriber & supply" className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <FormField label="Prescriber Name">
              <input {...register('prescriberName')} placeholder="e.g. Dr Smith" />
            </FormField>
            <FormField label="Pharmacy Name">
              <input {...register('pharmacyName')} placeholder="e.g. Chemist Warehouse" />
            </FormField>
            <FormField label="Pharmacy Phone" hint="Shown as a tap-to-call number in the missed-medication guidance.">
              <input type="tel" {...register('pharmacyPhone')} placeholder="e.g. 03 9123 4567" />
            </FormField>
          </div>
          <FormField label="Storage Requirements">
            <input {...register('storageRequirements')} placeholder="e.g. Refrigerate" />
          </FormField>
          <div className="grid sm:grid-cols-3 gap-4">
            <FormField label="Start Date">
              <input type="date" {...register('startDate')} />
            </FormField>
            <FormField label="End Date">
              <input type="date" {...register('endDate')} />
            </FormField>
            <FormField label="Next Review Due">
              <input type="date" {...register('nextReviewDue')} />
            </FormField>
          </div>
        </Card>

        {/* Consent */}
        <Card title="Consent" className="space-y-4">
          <FormField label="Consent Obtained" layout="checkbox">
            <input type="checkbox" {...register('consentObtained')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          {consentObtained && (
            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label="Consent Given By" required error={errors.consentGivenBy?.message}>
                <input {...register('consentGivenBy')} placeholder="e.g. Participant / Guardian name" />
              </FormField>
              <FormField label="Consent Date" required error={errors.consentDate?.message}>
                <input type="date" {...register('consentDate')} />
              </FormField>
            </div>
          )}
        </Card>

        {/* Notes */}
        <Card title="Notes" className="space-y-4 md:col-span-2">
          <FormField label="Notes">
            <textarea {...register('notes')} rows={3} placeholder="Any additional notes..." />
          </FormField>
        </Card>

        {/* Submit */}
        <div className="md:col-span-2 flex justify-end gap-3">
          <Link to={backTo} className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={mutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-[var(--color-primary)]/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Medication')}
          </button>
        </div>
      </form>
    </div>
  )
}
