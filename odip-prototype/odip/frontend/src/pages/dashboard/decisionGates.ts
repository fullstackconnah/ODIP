import type { usePermissions } from '@/lib/permissions'

export interface DecisionGates {
  completions: boolean
  leave: boolean
  incidents: boolean
  tasks: boolean
  compliance: boolean
  /** A SuperAdmin viewing no organisation: one line asks for one where the groups would be. */
  needsOrganisation: boolean
}

/**
 * Which decision groups this viewer gets on the dashboard: the server's own gates, so a role that would be refused never sees the group (SHAPE §3). A
 * SuperAdmin decides only inside an organisation, the canImportData test, so nothing is approved across every organisation at once.
 */
export function decisionGates(p: ReturnType<typeof usePermissions>, viewingOrganisation: boolean): DecisionGates {
  const decides = p.isAdmin || p.isCoordinator || (p.isSuperAdmin && viewingOrganisation)
  return {
    completions: decides && p.canReviewCompletions,
    leave: decides && p.canApproveLeave,
    incidents: decides,
    tasks: decides,
    compliance: decides && p.canWrite && p.canAccessPage('qualifications'),
    needsOrganisation: p.isSuperAdmin && !viewingOrganisation,
  }
}
