import { roleLabel } from '@/lib/format'

const labels = (stored: string | null | undefined) => (stored ?? '').split(',').filter(Boolean).map(roleLabel).join(', ')

/** The line under "Approved for rostering by ...": null for an approval made before the roles were recorded (or with nothing to say). */
export function approvalRolesLine(inForce: string | null | undefined, approvedAs: string | null | undefined): string | null {
  const parts = [
    labels(inForce) && `Roles that could approve at the time: ${labels(inForce)}.`,
    labels(approvedAs) && `Approved as: ${labels(approvedAs)}.`,
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}
