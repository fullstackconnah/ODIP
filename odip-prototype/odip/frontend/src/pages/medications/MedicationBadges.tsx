import { AlertTriangle, ShieldAlert, Brain, Clock3 } from 'lucide-react'
import { DRUG_SCHEDULE_LABELS, COMPLIANCE_FLAG_LABELS, type MedicationComplianceFlag } from '@/api/types/medications'
import type { DrugSchedule, MedicationType } from '@/api/types/enums'

type MedicationForChips = {
  isHighRisk: boolean
  isPsychotropic: boolean
  isChemicalRestraint: boolean
  type: MedicationType
  drugSchedule: DrugSchedule
}

const CHIP_BASE = 'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap'

/** Small chips summarising a medication's clinical/compliance-relevant flags. */
export function MedicationBadges({ medication, className }: { medication: MedicationForChips; className?: string }) {
  const chips: React.ReactNode[] = []

  if (medication.isHighRisk) {
    chips.push(
      <span key="high-risk" className={`${CHIP_BASE} bg-[var(--color-error-container)] text-[var(--color-on-error-container)]`} title="Requires a witness for every administered dose">
        <ShieldAlert className="w-3 h-3" /> High risk
      </span>
    )
  }

  if (medication.drugSchedule === 'Schedule4' || medication.drugSchedule === 'Schedule8') {
    chips.push(
      <span key="schedule" className={`${CHIP_BASE} bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]`}>
        {DRUG_SCHEDULE_LABELS[medication.drugSchedule]}
      </span>
    )
  }

  if (medication.isPsychotropic) {
    chips.push(
      <span key="psychotropic" className={`${CHIP_BASE} bg-[var(--color-secondary-container)] text-[var(--color-foreground)]`}>
        <Brain className="w-3 h-3" /> Psychotropic
      </span>
    )
  }

  if (medication.isChemicalRestraint) {
    chips.push(
      <span key="restraint" className={`${CHIP_BASE} bg-[var(--color-error-container)] text-[var(--color-on-error-container)]`}>
        <AlertTriangle className="w-3 h-3" /> Chemical restraint
      </span>
    )
  }

  if (medication.type === 'Prn') {
    chips.push(
      <span key="prn" className={`${CHIP_BASE} bg-[var(--color-muted)] text-[var(--color-muted-foreground)]`}>
        <Clock3 className="w-3 h-3" /> PRN
      </span>
    )
  }

  if (chips.length === 0) return null

  return <span className={`inline-flex flex-wrap items-center gap-1 ${className ?? ''}`}>{chips}</span>
}

const FLAG_STYLES: Record<MedicationComplianceFlag, string> = {
  ChemicalRestraintUnauthorised: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  ReviewOverdue: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  ConsentMissing: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
}

/** Standalone chips for a medication's `complianceFlags` — used in the Register table's Flags column. */
export function ComplianceFlagChips({ flags, className }: { flags: MedicationComplianceFlag[]; className?: string }) {
  if (!flags.length) return <span className="text-[var(--color-muted-foreground)]">—</span>
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      {flags.map(flag => (
        <span key={flag} className={`${CHIP_BASE} ${FLAG_STYLES[flag]}`}>
          <AlertTriangle className="w-3 h-3" /> {COMPLIANCE_FLAG_LABELS[flag]}
        </span>
      ))}
    </span>
  )
}
