import type { RosterFindingDto } from '@/api/types'

export interface RosterGate {
  blockingFindings: RosterFindingDto[]
  reasonRequiredFindings: RosterFindingDto[]
  /** True when any finding is Blocking — the save must be refused regardless of reason. */
  isBlocked: boolean
  /** True when any finding has requiresReason — the save needs a non-empty override reason. */
  needsReason: boolean
}

/**
 * Derives the save-gate state every roster-checked form needs from a findings list. Mirrors the
 * backend RosterGate (Odip.Api/Rostering/RosterGate.cs): any Blocking finding refuses the save;
 * any requiresReason finding needs a non-empty override reason. Pure — not a hook.
 */
export function getRosterGate(findings: RosterFindingDto[]): RosterGate {
  const blockingFindings = findings.filter(f => f.severity === 'Blocking')
  const reasonRequiredFindings = findings.filter(f => f.requiresReason)
  return {
    blockingFindings,
    reasonRequiredFindings,
    isBlocked: blockingFindings.length > 0,
    needsReason: reasonRequiredFindings.length > 0,
  }
}
