import { Link } from 'react-router-dom'
import { Pencil, Trash2, ArchiveRestore } from 'lucide-react'

export type ActionButtonsProps = {
  editTo?: string
  onEdit?: () => void
  onDelete?: () => void
  onRestore?: () => void
  showArchived?: boolean
}

export function ActionButtons({ editTo, onEdit, onDelete, onRestore, showArchived }: ActionButtonsProps) {
  const stop = (e: React.MouseEvent, fn?: () => void) => {
    e.stopPropagation()
    fn?.()
  }

  return (
    <div className="flex items-center gap-1">
      {editTo && (
        <Link to={editTo} onClick={e => e.stopPropagation()}
          className="p-1.5 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] transition-colors inline-block"
          title="Edit">
          <Pencil className="w-4 h-4" />
        </Link>
      )}
      {onEdit && (
        <button onClick={e => stop(e, onEdit)}
          className="p-1.5 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] transition-colors"
          title="Edit">
          <Pencil className="w-4 h-4" />
        </button>
      )}
      {showArchived && onRestore && (
        <button onClick={e => stop(e, onRestore)}
          className="p-1.5 rounded hover:bg-green-500/20 text-[var(--color-muted-foreground)] hover:text-green-400 transition-colors"
          title="Restore">
          <ArchiveRestore className="w-4 h-4" />
        </button>
      )}
      {!showArchived && onDelete && (
        <button onClick={e => stop(e, onDelete)}
          className="p-1.5 rounded hover:bg-red-500/20 text-[var(--color-muted-foreground)] hover:text-red-400 transition-colors"
          title="Archive">
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
