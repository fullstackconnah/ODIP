import { Link } from 'react-router-dom'

export type EmptyStateProps = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  action?: { label: string; to: string }
  className?: string
}

export function EmptyState({ icon: Icon, title, action, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-24 gap-4 ${className ?? ''}`}>
      <Icon className="w-16 h-16 text-[var(--color-foreground)] opacity-20" />
      <p className="text-lg font-semibold text-[var(--color-muted-foreground)]">{title}</p>
      {action && (
        <Link to={action.to} className="mt-2 text-sm font-bold text-[var(--color-primary)] hover:underline">
          {action.label}
        </Link>
      )}
    </div>
  )
}
