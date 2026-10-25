import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pencil, Archive, RotateCcw } from 'lucide-react'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'

// Same coarse-pointer floor as the Documents menu: a 32px option row lifts to --tap-min (0 on a mouse, so no change there).
const ICON_SLOT = 'flex min-h-[calc(var(--tap-min)-12px)] items-center'

type Props = {
  participantId: string
  canEditProfile: boolean
  canArchive: boolean
  canRestore: boolean
  onArchive: () => void
  onRestore: () => void
}

/** The header's "More actions" menu: the wizard, archive and restore. It renders nothing when the role can do none of them. */
export function ParticipantMoreMenu({ participantId, canEditProfile, canArchive, canRestore, onArchive, onRestore }: Props) {
  const navigate = useNavigate()
  const items: DropdownItem[] = [
    ...(canEditProfile ? [{ value: 'wizard', label: 'Edit full profile (wizard)', icon: <span className={ICON_SLOT}><Pencil className="w-4 h-4" /></span> }] : []),
    ...(canArchive ? [{ value: 'archive', label: 'Archive participant', icon: <span className={ICON_SLOT}><Archive className="w-4 h-4" /></span> }] : []),
    ...(canRestore ? [{ value: 'restore', label: 'Restore participant', icon: <span className={ICON_SLOT}><RotateCcw className="w-4 h-4" /></span> }] : []),
  ]
  if (items.length === 0) return null

  const onSelect = (value: string) => {
    if (value === 'wizard') navigate(`/participants/${participantId}/profile`)
    else if (value === 'archive') onArchive()
    else onRestore()
  }
  return (
    <Dropdown
      variant="menu"
      triggerVariant="secondary"
      label="More actions"
      iconOnlyBelowSm
      icon={<MoreHorizontal className="w-4 h-4" />}
      items={items}
      onSelect={onSelect}
    />
  )
}
