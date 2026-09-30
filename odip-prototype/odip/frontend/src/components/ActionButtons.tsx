import { Link } from 'react-router-dom'
import { Pencil, Trash2, ArchiveRestore } from 'lucide-react'
import { TAP_ICON_SQUARE } from './tapArea'

export type ActionButtonsProps = {
  editTo?: string
  onEdit?: () => void
  onDelete?: () => void
  onRestore?: () => void
  showArchived?: boolean
}

/**
 * The shape every icon control here shares. On a mouse it is what it always was: a 28px square (p-1.5 around a
 * 16px icon). Under `pointer: coarse` it is TAP_ICON_SQUARE: the `--control-h-sm` square (36px, the same size
 * `Button iconOnly` is there) with the icon centred, and TAP_AREA reaching its hit area out to 44px without
 * growing it. Two of them therefore need 8px between them on touch (4px of pad each side), which the wrapper's
 * `pointer-coarse:gap-2` gives; a mouse keeps `gap-1`. Inside a DataTable row `RowActions` pins the same 24px / 36px square from outside
 * (see ROW_ACTIONS_LEGACY_ICONS), and the two agree on touch.
 */
const ICON_BUTTON = `${TAP_ICON_SQUARE} rounded p-1.5 text-[var(--color-muted-foreground)] transition-colors`

export function ActionButtons({ editTo, onEdit, onDelete, onRestore, showArchived }: ActionButtonsProps) {
  const stop = (e: React.MouseEvent, fn?: () => void) => {
    e.stopPropagation()
    fn?.()
  }

  return (
    <div className="flex items-center gap-1 pointer-coarse:gap-2">
      {editTo && (
        <Link to={editTo} onClick={e => e.stopPropagation()}
          className={`${ICON_BUTTON} inline-block hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]`}
          title="Edit" aria-label="Edit">
          <Pencil className="w-4 h-4" />
        </Link>
      )}
      {onEdit && (
        <button onClick={e => stop(e, onEdit)}
          className={`${ICON_BUTTON} hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]`}
          title="Edit" aria-label="Edit">
          <Pencil className="w-4 h-4" />
        </button>
      )}
      {showArchived && onRestore && (
        <button onClick={e => stop(e, onRestore)}
          className={`${ICON_BUTTON} hover:bg-green-500/20 hover:text-green-400`}
          title="Restore" aria-label="Restore">
          <ArchiveRestore className="w-4 h-4" />
        </button>
      )}
      {!showArchived && onDelete && (
        <button onClick={e => stop(e, onDelete)}
          className={`${ICON_BUTTON} hover:bg-red-500/20 hover:text-red-400`}
          title="Archive" aria-label="Archive">
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
