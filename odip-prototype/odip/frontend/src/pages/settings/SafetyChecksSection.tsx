import { useId, useState, type ReactNode } from 'react'
import type { MedicationCompetencyMode, ParticipantReadinessMode } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageState } from '@/components/PageState'
import { retryingAfterError } from '@/lib/queryPhase'
import { TextField } from '@/components/TextField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { formGrid, span } from '@/lib/formGrid'
import { TONE } from '@/lib/tone'
import { IncompleteProfileNote } from './BillingDetailsSection'
import { SettingsGroup, SettingsSection, type SectionFrame } from './SettingsSection'
import { useProviderRow } from './providerRow'

type Mode = 'Warn' | 'Enforce'
const MODE_OPTIONS: { key: Mode; label: string }[] = [
  { key: 'Warn', label: 'Warn only' },
  { key: 'Enforce', label: 'Enforce' },
]

/** Each check: its heading, when it applies, what each mode does, and the sentence the tightening confirm says. */
const CHECKS = {
  readiness: {
    title: 'Participant readiness check',
    when: 'Before a participant is rostered, booked or activated.',
    words: { Warn: "Staff can roster, book and activate participants who aren't fully ready. The gaps show as warnings.", Enforce: 'Participants must be fully ready first, including a signed service agreement.' },
    confirm: "From now on, a participant who isn't fully ready can't be rostered, booked or activated.",
  },
  medication: {
    title: 'Medication competency check',
    when: 'When a staff member without a current medication competency records a dose.',
    words: { Warn: 'The dose is recorded and flagged for review.', Enforce: 'The dose is refused.' },
    confirm: "From now on, staff without a current medication competency can't record a dose. Check your team's competencies first.",
  },
} as const

// Kept while it is true: ParticipantReadiness counts nobody as signed until the agreement source is approved for electronic signing
// (ProvisionalAgreementTemplate.State). Drop it when that changes.
const READINESS_CAVEAT = "Signed agreements can't be recorded yet, so Enforce would block every participant with no way to clear it. Keep Warn only for now."

/** One safety check in a bordered block of its own: the two switches are the weightiest things in Settings. */
function CheckBlock({ check, value, saved, disabled, onChange, children }: {
  check: keyof typeof CHECKS
  value: Mode
  saved: Mode
  disabled: boolean
  onChange: (mode: Mode) => void
  children?: ReactNode
}) {
  const { title, when, words } = CHECKS[check]
  const headingId = useId()
  const wordsId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-[var(--field-gap-y)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)]">
      <h3 id={headingId} className="text-sm font-semibold">{title}</h3>
      <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">{when}</p>
      <ToggleGroup className="flex-wrap" ariaLabel={title} ariaDescribedby={wordsId} options={MODE_OPTIONS} value={value} onChange={key => onChange(key as Mode)} disabled={disabled} />
      <ul id={wordsId} className="flex max-w-prose flex-col gap-1 text-sm">
        {MODE_OPTIONS.map(option => (
          <li key={option.key} className={option.key === value ? 'text-[var(--color-foreground)]' : 'text-[var(--color-muted-foreground)]'}>
            <span className="font-medium">{option.label}.</span> {words[option.key]}
          </li>
        ))}
      </ul>
      {value !== saved && <p className={`max-w-prose text-sm ${TONE.warning.ink}`}>Not saved yet. From when you save: {words[value]}</p>}
      {children}
    </section>
  )
}

/**
 * Organisation › Safety checks: what ODIP stops and what it only warns about, plus who staff call about a missed dose. Tightening a check
 * (Warn only to Enforce) asks once; loosening saves without asking. Both modes are last-write-wins on the server and audited there.
 */
/**
 * A mode kept out of the form on purpose (unchanged from Provider settings). `server` is the server's current value (no row reads as Warn);
 * the pick is the person's choice with the server value they chose it against. Only a deliberate pick that differs from the server is
 * sent, and a pick is dropped for good once the server moves on (our own save landed, or another Admin changed it), so a stale section
 * never pushes an old choice back over a newer one, and always shows the mode the server holds.
 */
function useModePick(server: Mode) {
  const [pick, setPick] = useState<{ value: Mode; base: Mode } | null>(null)
  if (pick && pick.base !== server) setPick(null)
  const shown = pick?.value ?? server
  return { shown, changed: shown !== server, choose: (value: Mode) => setPick({ value, base: server }) }
}

export default function SafetyChecksSection(frame: SectionFrame) {
  const p = useProviderRow(row => ({ managerName: row?.managerName ?? '', managerPhone: row?.managerPhone ?? '' }))
  const serverReadiness: ParticipantReadinessMode = p.row?.participantReadinessMode ?? 'Warn'
  const serverMedication: MedicationCompetencyMode = p.row?.medicationCompetencyMode ?? 'Warn'
  const readinessMode = useModePick(serverReadiness)
  const medicationMode = useModePick(serverMedication)
  const [confirming, setConfirming] = useState(false)

  const locked = frame.readOnly || p.incomplete
  const tightens = { readiness: readinessMode.changed && readinessMode.shown === 'Enforce', medication: medicationMode.changed && medicationMode.shown === 'Enforce' }
  const both = tightens.readiness && tightens.medication

  const save = () => {
    setConfirming(false)
    p.save({
      ...(readinessMode.changed ? { participantReadinessMode: readinessMode.shown } : {}),
      ...(medicationMode.changed ? { medicationCompetencyMode: medicationMode.shown } : {}),
    })
  }

  return (
    <SettingsSection
      {...frame}
      save={p.form && !p.incomplete ? { dirty: p.dirty || readinessMode.changed || medicationMode.changed, pending: p.pending, result: p.result, onSave: () => (tightens.readiness || tightens.medication ? setConfirming(true) : save()) } : undefined}
    >
      {(p.query.isError || retryingAfterError(p.query)) && !p.form ? <PageState kind="error" noun="safety checks section" onRetry={() => p.query.refetch()} />
        : !p.form ? <PageState kind="loading" noun="safety checks section" />
        : (
          <>
            {p.incomplete && !frame.readOnly && <IncompleteProfileNote />}
            <CheckBlock check="readiness" value={readinessMode.shown} saved={serverReadiness} disabled={locked} onChange={readinessMode.choose}>
              <p className={`max-w-prose text-sm ${TONE.warning.ink}`}>{READINESS_CAVEAT}</p>
            </CheckBlock>
            <CheckBlock check="medication" value={medicationMode.shown} saved={serverMedication} disabled={locked} onChange={medicationMode.choose} />
            <SettingsGroup title="Who staff call about a missed dose">
              <div className={formGrid}>
                <TextField label="Manager name" hint={p.hint('managerName')} placeholder="For example: Priya Sharma" className={span.medium} value={p.form.managerName} readOnly={locked} onChange={e => p.edit({ managerName: e.target.value })} />
                <TextField label="Manager phone" hint={p.hint('managerPhone')} placeholder="For example: 0412 345 007" inputMode="tel" className={span.short} value={p.form.managerPhone} readOnly={locked} onChange={e => p.edit({ managerPhone: e.target.value })} />
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">Shown first to staff who need guidance on a missed medication.</p>
            </SettingsGroup>
            <ConfirmDialog
              open={confirming}
              title={both ? 'Turn on Enforce for both checks?' : tightens.readiness ? 'Turn on Enforce for the readiness check?' : 'Turn on Enforce for medication competency?'}
              message={<>{tightens.readiness && <p>{CHECKS.readiness.confirm}</p>}{tightens.medication && <p>{CHECKS.medication.confirm}</p>}</>}
              confirmLabel={both ? 'Turn on Enforce for both' : 'Turn on Enforce'}
              onConfirm={save}
              onCancel={() => setConfirming(false)}
            />
          </>
        )}
    </SettingsSection>
  )
}
