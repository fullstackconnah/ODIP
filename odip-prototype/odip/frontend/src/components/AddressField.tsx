import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { apiGet, apiPost } from '@/api/client'
import { inputClass } from '@/components/FormField'
import { addressLookup, switchAddressLookupOff } from '@/lib/addressLookupState'

export type AddressParts = { street: string; suburb: string; state: string; postcode: string; formatted: string }
type Suggestion = { placeId: string; mainText: string; secondaryText: string }
type Details = { street: string; suburb: string; state: string; postcode: string; formattedAddress: string }

export type AddressFieldProps = {
  id?: string
  value: string
  /** Every keystroke, and the street text after a pick. Typing is never blocked or rewritten. */
  onChange: (text: string) => void
  /** After a pick: the caller sets its other address fields from the parts (a part the place lacks is ''). */
  onPick: (parts: AddressParts) => void
  maxLength?: number
  placeholder?: string
  onBlur?: () => void
  'aria-labelledby'?: string
  'aria-required'?: 'true'
  'aria-describedby'?: string
  'aria-invalid'?: 'true'
}

const MIN_CHARS = 3
const DEBOUNCE_MS = 250
const MAX_ROWS = 5

/** 16 random bytes as 22 URL-safe characters. getRandomValues, never randomUUID: live is plain HTTP, where randomUUID does not exist. */
function newSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const statusOf = (err: unknown) => (err as { response?: { status?: number } })?.response?.status

/**
 * The first line of a postal address, with Australian address suggestions from the server's Google proxy. It replaces the caller's street input inside the same
 * FormField. A WAI-ARIA 1.2 combobox with list autocomplete (as SearchableSelect), but typing is the point: the text is the caller's, every keystroke goes straight to
 * `onChange`, and a failed, slow or refused lookup is silent, leaving a plain input. A pick fetches the place's parts and hands them to `onPick`.
 * The list never opens on focus alone, so tabbing through a filled form stays quiet; Down opens it once there are suggestions.
 */
export function AddressField({
  id, value, onChange, onPick, maxLength, placeholder, onBlur,
  'aria-labelledby': ariaLabelledBy, 'aria-required': ariaRequired, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid,
}: AddressFieldProps) {
  const listboxId = useId()
  const [rows, setRows] = useState<Suggestion[] | null>(null)   // null: no answer yet; []: asked, nothing found
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [status, setStatus] = useState('')
  const [used, setUsed] = useState(false)
  const [plain, setPlain] = useState(addressLookup.off)   // the server said 404: a plain input from now on
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})

  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const inflight = useRef<AbortController>(undefined)
  const session = useRef<string | null>(null)
  const latest = useRef(value)
  const onChangeRef = useRef(onChange)
  const onPickRef = useRef(onPick)
  useEffect(() => { onChangeRef.current = onChange; onPickRef.current = onPick })
  useEffect(() => () => { clearTimeout(timer.current); inflight.current?.abort() }, [])

  const optionId = (i: number) => `${listboxId}-opt-${i}`
  const showing = open && rows !== null
  const empty = showing && rows.length === 0

  // Below the input when the list fits there, else above when that has more room; the list scrolls only when neither side holds it.
  const reposition = useCallback(() => {
    if (!boxRef.current) return
    const rect = boxRef.current.getBoundingClientRect()
    const need = panelRef.current?.scrollHeight ?? 0
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const style: CSSProperties = { position: 'fixed', zIndex: 9999, left: rect.left, width: rect.width, overflowY: 'auto' }
    if (need <= below || below >= above) { style.top = rect.bottom + 4; style.maxHeight = below }
    else { style.bottom = window.innerHeight - rect.top + 4; style.maxHeight = above }
    setPanelStyle(style)
  }, [])

  // Re-measured when the rows change, because the list's own height decides the side.
  useLayoutEffect(() => {
    if (showing) reposition()
  }, [showing, rows, reposition])

  useEffect(() => {
    if (!showing) return
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [showing, reposition])

  function close() {
    setOpen(false)
    setActive(-1)
  }

  async function query(text: string) {
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    session.current ??= newSessionToken()
    setUsed(true)
    try {
      const found = await apiPost<Suggestion[]>('/address/suggest', { q: text.trim(), session: session.current }, { signal: controller.signal })
      // A slower answer for text that has since changed is dropped.
      if (controller.signal.aborted || latest.current !== text) return
      const next = (found ?? []).slice(0, MAX_ROWS)
      setRows(next)
      setActive(-1)
      setStatus(next.length === 0 ? 'No matching address' : next.length === 1 ? '1 suggestion' : `${next.length} suggestions`)
      setOpen(document.activeElement === inputRef.current)
    } catch (err) {
      if (controller.signal.aborted) return
      if (statusOf(err) === 404) { switchAddressLookupOff(); setPlain(true) }
      // Any other failure (400, 429, 5xx, offline) is silent: the list closes and typing carries on.
      setRows(null)
      close()
    }
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const text = e.target.value
    latest.current = text
    onChangeRef.current(text)
    clearTimeout(timer.current)
    inflight.current?.abort()
    if (addressLookup.off || text.trim().length < MIN_CHARS) {
      setRows(null)
      close()
      return
    }
    timer.current = setTimeout(() => query(text), DEBOUNCE_MS)
  }

  async function pick(row: Suggestion) {
    clearTimeout(timer.current)
    inflight.current?.abort()
    const token = session.current
    session.current = null   // the details call ends Google's billing session; the next typing starts a new one
    close()
    setRows(null)
    const at = latest.current
    let parts: AddressParts | null = null
    try {
      const d = await apiGet<Details>('/address/details', { placeId: row.placeId, session: token })
      parts = { street: d.street, suburb: d.suburb, state: d.state, postcode: d.postcode, formatted: d.formattedAddress }
    } catch { /* silent: the prediction's own text goes in below */ }
    if (latest.current !== at) return   // the person kept typing while details loaded
    const street = (parts ? parts.street : row.mainText).slice(0, maxLength ?? Infinity)
    latest.current = street
    onChangeRef.current(street)
    if (parts) {
      onPickRef.current(parts)
      setStatus('Address filled in.')
    }
    inputRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (!showing) {
        if (addressLookup.off || rows === null || value.trim().length < MIN_CHARS) return
        e.preventDefault()
        setOpen(true)
        return
      }
      e.preventDefault()
      setActive((a) => Math.min(a + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp' && showing) {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && showing && active >= 0 && rows[active]) {
      e.preventDefault()   // the form must not submit on a pick
      pick(rows[active])
    } else if (e.key === 'Escape' && showing) {
      e.preventDefault()
      e.stopPropagation()   // the list closes alone; a surrounding panel or dialog stays open
      close()
    } else if (e.key === 'Tab') {
      close()
    }
  }

  const combo = !plain
  const panel = showing && createPortal(
    <div ref={panelRef} style={panelStyle} className="bg-[var(--color-popover)] rounded-[var(--radius-md)] shadow-[var(--shadow-float)] py-1">
      {empty ? (
        <p className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">No matching address. Keep typing, or enter it yourself.</p>
      ) : (
        <>
          <div role="listbox" id={listboxId} aria-label="Address suggestions">
            {rows.map((row, i) => (
              <div
                key={row.placeId}
                role="option"
                id={optionId(i)}
                aria-selected={active === i}
                // Focus stays in the input: a press on a row must not blur it before the click that picks.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(row)}
                onMouseEnter={() => setActive(i)}
                className={`min-h-[max(var(--control-h),var(--tap-min))] flex flex-col justify-center px-3 py-1.5 text-sm text-left break-words cursor-pointer transition-colors ${
                  active === i ? 'bg-[var(--color-surface-container-low)]' : 'hover:bg-[var(--color-surface-container-low)]'
                }`}
              >
                <span className="text-[var(--color-foreground)]">{row.mainText}</span>
                {row.secondaryText && <span className="text-[13px] text-[var(--color-muted-foreground)]">{row.secondaryText}</span>}
              </div>
            ))}
          </div>
          {/* Google's content is set apart in its own container, outside the listbox. The current policy asks for "Google Maps", not "Powered by Google". */}
          <p className="mt-1 px-3 pt-1 border-t border-[var(--color-border)] text-right text-xs text-[var(--color-muted-foreground)]">Google Maps</p>
        </>
      )}
    </div>,
    document.body,
  )

  return (
    <div className="relative w-full" ref={boxRef}>
      <input
        ref={inputRef}
        type="text"
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        role={combo ? 'combobox' : undefined}
        aria-autocomplete={combo ? 'list' : undefined}
        aria-expanded={combo ? showing : undefined}
        aria-controls={combo && showing && !empty ? listboxId : undefined}
        aria-activedescendant={showing && !empty && active >= 0 ? optionId(active) : undefined}
        aria-labelledby={ariaLabelledBy}
        aria-required={ariaRequired}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => { close(); onBlur?.() }}
        className={inputClass}
      />
      {used && <span role="status" aria-live="polite" className="sr-only">{status}</span>}
      {panel}
    </div>
  )
}
