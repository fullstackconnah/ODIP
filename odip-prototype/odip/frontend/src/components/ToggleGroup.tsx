export type ToggleOption = {
  key: string
  label: string
}

export type ToggleGroupProps = {
  options: ToggleOption[]
  value: string
  onChange: (key: string) => void
  className?: string
}

export function ToggleGroup({ options, value, onChange, className }: ToggleGroupProps) {
  return (
    <div className={`flex gap-2 ${className ?? ''}`}>
      {options.map(opt => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            value === opt.key
              ? 'bg-[var(--color-primary)] text-white'
              : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
