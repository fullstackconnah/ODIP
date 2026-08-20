import { Link } from 'react-router-dom'

export type EmptyStateAction =
  | { label: string; to: string; onClick?: never }
  | { label: string; onClick: () => void; to?: never }

export type EmptyStateProps = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  /** Body copy explaining what the item is and why the user would create one. */
  description?: string
  action?: EmptyStateAction
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-24 gap-3 ${className ?? ''}`}>
      <Icon className="w-16 h-16 text-[var(--color-foreground)] opacity-20" />
      <p className="text-lg font-semibold text-[var(--color-muted-foreground)]">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-[var(--color-muted-foreground)] opacity-80">{description}</p>
      )}
      {action && (
        action.to ? (
          <Link to={action.to} className="mt-2 text-sm font-bold text-[var(--color-primary)] hover:underline">
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-2 text-sm font-bold text-[var(--color-primary)] hover:underline"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  )
}
