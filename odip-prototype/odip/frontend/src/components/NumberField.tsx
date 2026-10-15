import { useState } from 'react'
import { TextField } from '@/components/TextField'

type NumberFieldProps = {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number | string
  hint?: string
  error?: string
  className?: string
  /** `decimal` for money and kilometres, `numeric` (the default) for counts. */
  inputMode?: 'numeric' | 'decimal'
  disabled?: boolean
}

/**
 * A number input that keeps what the person is typing apart from the number it means. Clearing the box to type another figure leaves it empty (the value is
 * NaN, which the block's own checks call "enter a number") instead of snapping to 0 under the cursor, and a value changed from outside (a template, a toggle)
 * is shown as soon as it arrives.
 */
export function NumberField({ label, value, onChange, inputMode = 'numeric', ...rest }: NumberFieldProps) {
  const [text, setText] = useState(() => (Number.isNaN(value) ? '' : String(value)))
  const [seen, setSeen] = useState(value)
  if (!Object.is(seen, value)) {
    setSeen(value)
    const typed = text.trim() === '' ? Number.NaN : Number(text)
    if (!Object.is(typed, value)) setText(Number.isNaN(value) ? '' : String(value))
  }

  return (
    <TextField
      {...rest}
      label={label}
      type="number"
      inputMode={inputMode}
      value={text}
      onChange={event => {
        const next = event.target.value
        setText(next)
        const parsed = next.trim() === '' ? Number.NaN : Number(next)
        setSeen(parsed)
        onChange(parsed)
      }}
    />
  )
}
