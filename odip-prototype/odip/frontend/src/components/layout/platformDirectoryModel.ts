import type { ModuleVisibilityDto } from '@/api/types'
import { navItems, resolveNav, type NavAccess, type NavLeaf, type ResolvedEntry } from './navConfig'

const DESCRIPTIONS: Record<string, string> = {
  '/': 'Review alerts and decisions waiting for you.',
  '/portal': 'Open your assigned shifts and care checklists.',
  '/trips': 'Plan trips and review their participants and arrangements.',
  '/schedule': 'Assign staff, vehicles and resources to trips.',
  '/bookings': 'Manage participant bookings and reservations.',
  '/accommodation': 'Manage properties and accommodation availability.',
  '/vehicles': 'Manage the fleet and vehicle availability.',
  '/tasks': 'Track trip tasks and follow-up work.',
  '/participants': 'Manage enquiries, onboarding and participant records.',
  '/medications': 'Review medication plans and administration records.',
  '/caregiver-submissions': 'Review submitted caregiver forms.',
  '/rostering': 'Plan participant shifts and staff coverage.',
  '/rostering/patterns': 'Manage recurring shift patterns.',
  '/rostering/compatibility': 'Review staff and participant compatibility.',
  '/rostering/leave': 'Review leave and unavailability requests.',
  '/rostering/completions': 'Review submitted shifts before billing.',
  '/reports': 'Hours, shift fulfilment and leave for any date range.',
  '/staff': 'Manage staff details and credentials.',
  '/qualifications': 'Review qualifications and upcoming expiry dates.',
  '/budgets': 'Review participant funding and budget risk.',
  '/incidents': 'Record incidents and track required follow-up.',
  '/settings': 'Manage your account and permitted organisation settings.',
}

export const pageDescription = (leaf: NavLeaf) => DESCRIPTIONS[leaf.to] ?? leaf.label

export function platformNavigation(access: NavAccess, visibility?: ModuleVisibilityDto): ResolvedEntry[] {
  if (!['SuperAdmin', 'Admin', 'Coordinator', 'SupportWorker', 'ReadOnly'].includes(access.role ?? '')) return []
  return resolveNav(navItems, access, visibility)
}

export function platformLeaves(entries: ResolvedEntry[]): NavLeaf[] {
  return entries.flatMap(entry => entry.kind === 'group' ? entry.children : [entry.leaf])
}
