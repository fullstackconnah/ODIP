export type Tab = {
  key: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

export type TabNavProps = {
  tabs: Tab[]
  active: string
  onChange: (key: string) => void
  className?: string
}

export function TabNav({ tabs, active, onChange, className }: TabNavProps) {
  return (
    <div className={`flex gap-4 border-b border-[var(--color-border)] ${className ?? ''}`}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            active === t.key
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-transparent text-[var(--color-muted-foreground)]'
          }`}
        >
          {t.icon && <t.icon className="w-4 h-4" />}
          {t.label}
        </button>
      ))}
    </div>
  )
}
