import { useState, useRef, useEffect, useCallback, useId } from 'react'
import type { CSSProperties, KeyboardEvent, ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { inputClass } from '@/components/FormField'
import type { DropdownItem } from '@/components/Dropdown'

/** Re-exported under this component's own name so callers don't have to reach into Dropdown
 * for a type that's really shared vocabulary between the two pickers. */
export type SearchableSelectItem = DropdownItem

export type SearchableSelectProps = {
  items: SearchableSelectItem[]
  value: string
  onChange: (value: string) => void
  /** Forward field.onBlur from an RHF Controller, mirroring Dropdown's contract. Fired on
   * selection and whenever the popup closes without one (outside click, Escape, Tab-away). */
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  /** Options are still loading — shows a spinner in the trigger and a "Loading options…" row
   * instead of the empty message. The input itself stays editable so a query can be typed while
   * the list is still arriving. */
  loading?: boolean
  /** Message shown when `items` is empty (and not loading). Defaults to 'No options available'. */
  emptyMessage?: string
  /** Message shown when a query is typed and nothing matches. Defaults to 'No results found'. */
  noMatchMessage?: string
  className?: string

  // Labelling — lets a wrapping component (e.g. FormField) associate an external <label>
  // with the input, matching Dropdown's labelling contract exactly.
  id?: string
  'aria-labelledby'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: 'true'
  'aria-describedby'?: string
}

/**
 * A typeahead single-select built on the WAI-ARIA 1.2 "combobox with list autocomplete" pattern:
 * a text input carries `role="combobox"` / `aria-expanded` / `aria-controls` / `aria-autocomplete`
 * and moves a virtual cursor via `aria-activedescendant` instead of moving DOM focus into the
 * popup — the popup itself is a `role="listbox"` of `role="option"` rows. This is the primitive
 * to reach for whenever a Dropdown's option list is large enough that scanning it beats clicking
 * through it (the FormField hint API, id/label wiring, and 44px targets all match Dropdown's
 * 'form' variant so the two are drop-in swaps for each other under a FormField).
 *
 * The input's displayed text is derived, not stored: while closed it's always the current
 * selection's label (recomputed straight from the `value`/`items` props, so it can never drift
 * out of sync with a controlling parent); opening the field clears it to an empty query so the
 * full option list is immediately browsable by arrow keys without typing a character, and typing
 * narrows it from there. Selecting an option, pressing Escape, or clicking outside all close the
 * popup — Escape/outside-click discard whatever was typed, snapping the field straight back to
 * the (unchanged) selection's label.
 */
export function SearchableSelect({
  items,
  value,
  onChange,
  onBlur,
  placeholder = 'Search…',
  disabled = false,
  loading = false,
  emptyMessage = 'No options available',
  noMatchMessage = 'No results found',
  className,
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SearchableSelectProps) {
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const onBlurRef = useRef(onBlur)
  useEffect(() => { onBlurRef.current = onBlur })

  const selectedItem = items.find(i => i.value === value)
  const displayValue = open ? query : (selectedItem?.label ?? '')

  const trimmedQuery = query.trim()
  const filteredItems = !open || !trimmedQuery
    ? items
    : items.filter(item => item.label.toLowerCase().includes(trimmedQuery.toLowerCase()))

  const enabledIndices = filteredItems
    .map((item, i) => (item.disabled ? -1 : i))
    .filter(i => i !== -1)

  const optionId = (idx: number) => `${listboxId}-opt-${idx}`

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const maxPanelHeight = 320
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const style: CSSProperties = { position: 'fixed', zIndex: 9999, left: rect.left, width: rect.width, overflowY: 'auto' }
    if (spaceBelow >= spaceAbove || spaceBelow >= 120) {
      style.top = rect.bottom + 4
      style.maxHeight = Math.min(maxPanelHeight, spaceBelow)
    } else {
      style.bottom = window.innerHeight - rect.top + 4
      style.maxHeight = Math.min(maxPanelHeight, spaceAbove)
    }
    setPanelStyle(style)
  }, [])

  useEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      const inContainer = containerRef.current?.contains(target)
      const inPanel = panelRef.current?.contains(target)
      if (!inContainer && !inPanel) closePopup()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function openPopup() {
    if (disabled) return
    setOpen(true)
    setQuery('')
    setActiveIndex(-1)
  }

  /** Closes without a selection — Escape, outside click, Tab-away. The field's displayed text
   * snaps back to the current `value`'s label automatically, since it's derived, not stored. */
  function closePopup() {
    setOpen(false)
    setActiveIndex(-1)
    onBlurRef.current?.()
  }

  function handleSelect(item: SearchableSelectItem) {
    if (item.disabled) return
    onChange(item.value)
    setOpen(false)
    setActiveIndex(-1)
    onBlur?.()
    // Belt-and-suspenders alongside the option rows' onMouseDown preventDefault below: a mouse
    // click on an option would otherwise blur the input (the browser blurs on mousedown, before
    // the click that commits the selection fires) and strand focus nowhere, breaking this
    // component's "focus never leaves the input" contract. This re-focus also covers any
    // selection path that isn't a mouse click at all (e.g. programmatic/touch).
    inputRef.current?.focus()
  }

  function handleFocus() {
    openPopup()
  }

  function handleClick() {
    if (!open) openPopup()
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setActiveIndex(-1)
    if (!open) setOpen(true)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openPopup()
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      closePopup()
      return
    }
    if (e.key === 'Tab') {
      closePopup()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (enabledIndices.length === 0) return
      const pos = enabledIndices.indexOf(activeIndex)
      const next = enabledIndices[(pos + 1) % enabledIndices.length]
      setActiveIndex(next ?? enabledIndices[0])
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (enabledIndices.length === 0) return
      const pos = enabledIndices.indexOf(activeIndex)
      const prev = pos === -1
        ? enabledIndices[enabledIndices.length - 1]
        : enabledIndices[(pos - 1 + enabledIndices.length) % enabledIndices.length]
      setActiveIndex(prev ?? enabledIndices[0])
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      if (enabledIndices.length > 0) setActiveIndex(enabledIndices[0])
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      if (enabledIndices.length > 0) setActiveIndex(enabledIndices[enabledIndices.length - 1])
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const active = activeIndex >= 0 ? filteredItems[activeIndex] : undefined
      const target = active
        ?? (filteredItems.length === 1 && !filteredItems[0]?.disabled ? filteredItems[0] : undefined)
      if (target) handleSelect(target)
    }
  }

  const showLoadingRow = loading && items.length === 0
  const showEmptyRow = !showLoadingRow && filteredItems.length === 0

  const panel = open && createPortal(
    <div
      ref={panelRef}
      role="listbox"
      id={listboxId}
      style={panelStyle}
      className="bg-white rounded-2xl shadow-[0_24px_40px_-12px_rgba(27,28,26,0.14)] py-1"
    >
      {showLoadingRow ? (
        <p role="presentation" className="px-4 py-3 text-sm text-[var(--color-muted-foreground)] flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
          Loading options…
        </p>
      ) : showEmptyRow ? (
        <p role="presentation" className="px-4 py-3 text-sm text-[var(--color-muted-foreground)] opacity-70">
          {trimmedQuery ? noMatchMessage : emptyMessage}
        </p>
      ) : (
        filteredItems.map((item, idx) => (
          <div
            key={item.value}
            role="option"
            id={optionId(idx)}
            aria-selected={item.value === value}
            aria-disabled={item.disabled ? 'true' : undefined}
            // Prevents the browser's default mousedown-blur: without this, clicking an option
            // blurs the input before the click event that commits the selection ever fires,
            // stranding DOM focus outside the component. See handleSelect's re-focus for the
            // belt-and-suspenders half of this (W3C APG / Downshift combobox pattern).
            onMouseDown={e => e.preventDefault()}
            onClick={() => handleSelect(item)}
            onMouseEnter={() => !item.disabled && setActiveIndex(idx)}
            className={`min-h-[44px] flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-foreground)] text-left transition-colors cursor-pointer ${
              item.disabled
                ? 'opacity-40 cursor-not-allowed'
                : activeIndex === idx
                ? 'bg-[var(--color-surface-container-low)]'
                : 'hover:bg-[var(--color-surface-container-low)]'
            }`}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <div className="min-w-0">
              <p className={item.description ? 'font-semibold' : ''}>{item.label}</p>
              {item.description && (
                <p className="text-[11px] text-[var(--color-muted-foreground)]">{item.description}</p>
              )}
            </div>
          </div>
        ))
      )}
    </div>,
    document.body,
  )

  return (
    <div className={`relative w-full ${className ?? ''}`} ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-required={ariaRequired}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        disabled={disabled}
        value={displayValue}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={handleFocus}
        onClick={handleClick}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={`${inputClass} min-h-[44px] pr-9 disabled:opacity-60 disabled:cursor-not-allowed`}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-60">
        {loading ? (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin block" />
        ) : (
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        )}
      </span>
      {panel}
    </div>
  )
}
