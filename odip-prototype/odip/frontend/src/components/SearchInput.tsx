import { Search } from 'lucide-react'

export type SearchInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  label?: string
}

export function SearchInput({ value, onChange, placeholder = 'Search...', className, label }: SearchInputProps) {
  return (
    <div className={`relative ${className ?? 'max-w-md flex-1'}`}>
      <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-foreground)]" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="w-full h-[var(--control-h)] pl-10 pr-4 rounded-[var(--radius-sm)] bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
      />
    </div>
  )
}
