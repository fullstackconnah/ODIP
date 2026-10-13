import { StatusBadge } from '@/components/StatusBadge'

/** "Authorised" or "Not authorised", in colour and in words: a register entry by the shared rule (isRpAuthorised), or an incident's stored determination. */
export function RpAuthorisationBadge({ authorised }: { authorised: boolean }) {
  return <StatusBadge tone={authorised ? 'success' : 'danger'} label={authorised ? 'Authorised' : 'Not authorised'} />
}
