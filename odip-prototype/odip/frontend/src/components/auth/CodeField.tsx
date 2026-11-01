import type { Ref } from 'react'
import { inputClass } from '@/components/FormField'

/** The 6-digit code from an authenticator app. Shared by the sign-in step and set-up so both take it the same way (spaces fine, 16 px text, one-time-code autofill). */
export function CodeField({ id, value, onChange, invalid, describedBy, ref }: {
  id: string
  value: string
  onChange: (typed: string) => void
  invalid?: boolean
  describedBy?: string
  ref?: Ref<HTMLInputElement>
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">Code</label>
      <input
        ref={ref}
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`${inputClass} min-w-[10ch] text-base tracking-widest tabular-nums`}
      />
    </div>
  )
}
