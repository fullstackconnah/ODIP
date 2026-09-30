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
  /** 'inline' trims vertical padding to py-6 for use inside a table body / dense panel;
   * defaults to 'default' (py-10) for a full page-level empty state. */
  size?: 'default' | 'inline'
}

export function EmptyState({ icon: Icon, title, description, action, className, size = 'default' }: EmptyStateProps) {
  const paddingClass = size === 'inline' ? 'py-6' : 'py-10'
  return (
    <div className={`flex flex-col items-center justify-center text-center ${paddingClass} gap-3 ${className ?? ''}`}>
      <Icon className="w-10 h-10 text-[var(--color-foreground)] opacity-20" />
      <p className="text-lg font-semibold text-[var(--color-muted-foreground)]">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-[var(--color-muted-foreground)] opacity-80">{description}</p>
      )}
      {action && (
        // inline-flex + min-h-[44px] gives the link/button a WCAG 2.5.5-sized tap target without
        // growing the text visually — the extra height is invisible padding, not a bigger glyph.
        action.to ? (
          <Link
            to={action.to}
            className="mt-2 inline-flex min-h-[44px] items-center justify-center px-2 text-sm font-bold text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-2 inline-flex min-h-[44px] items-center justify-center px-2 text-sm font-bold text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  )
}
