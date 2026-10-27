import { useState, useRef, useEffect, useCallback, useId } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { TAP_AREA } from './tapArea'
import { buttonClasses, type ButtonVariant } from './buttonClasses'

export type DropdownItem = {
  value: string
  label: string
  icon?: ReactNode
  description?: string
  disabled?: boolean
}

type DropdownProps = {
  /** 'icon' is a compact icon-only trigger (e.g. a kebab action menu on a card/chip) — same portal/keyboard machinery as 'menu', just a small icon button instead of the Button-look trigger. */
  variant: 'pill' | 'form' | 'menu' | 'icon'
  items: DropdownItem[]

  // Value control — pill and form variants
  value?: string
  onChange?: (value: string) => void
  // Menu variant: fires on item selection, no tracked value
  onSelect?: (value: string) => void
  // Form variant: forward field.onBlur from RHF Controller
  onBlur?: () => void

  // Trigger appearance
  label?: string            // button text (menu), placeholder text (form)
  icon?: ReactNode          // leading icon on trigger (menu variant)
  /** Menu variant: below `sm` the trigger is a square icon button (the label stays as its accessible name, the chevron goes); from `sm` up it is the normal labelled trigger. */
  iconOnlyBelowSm?: boolean
  /** Menu variant: the Button look of the trigger. Primary for a header action; secondary for an in-page menu, so a page keeps one filled primary. */
  triggerVariant?: Extract<ButtonVariant, 'primary' | 'secondary'>
  colorClass?: string       // Tailwind color classes for pill trigger background
  /** Icon variant: replaces the small icon-button look, so a header icon can match its neighbours' size. */
  triggerClassName?: string
  disabled?: boolean        // caller controls — not auto-applied on empty items
  loading?: boolean
  /** Panel height cap in px (default 320). A tall list passes a larger cap; the room on screen then limits it, and an overflowing list is trimmed to end on half a row so the cut says it scrolls. */
  maxPanelHeight?: number

  // Panel alignment — default varies by variant: pill='right', form='left', menu='right'
  align?: 'left' | 'right'
  searchable?: boolean

  // Labelling — lets a wrapping component (e.g. FormField) associate an external <label>
  // with the trigger button, since the button itself carries no visible label text.
  // Not applied to the 'icon' variant, which labels itself via `label`/aria-label instead.
  id?: string
  'aria-labelledby'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: 'true'
  'aria-describedby'?: string
}

export function Dropdown({
  variant,
  items,
  value,
  onChange,
  onSelect,
  onBlur,
  label,
  icon,
  iconOnlyBelowSm,
  triggerVariant = 'primary',
  colorClass = '',
  triggerClassName,
  disabled = false,
  loading = false,
  maxPanelHeight,
  align,
  searchable = false,
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: DropdownProps) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const onBlurRef = useRef(onBlur)
  useEffect(() => { onBlurRef.current = onBlur })
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Per-variant default alignment
  const resolvedAlign = align ?? (variant === 'form' ? 'left' : 'right')

  // Compute panel position from trigger's current viewport rect
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const cap = maxPanelHeight ?? 320
    // A fixed bottom bar (the phone nav) is not room: a panel opened over it loses its last options.
    const nav = document.querySelector('nav[aria-label="Mobile"]')?.getBoundingClientRect()
    const floor = nav && nav.height > 0 && nav.top < window.innerHeight ? nav.top : window.innerHeight
    const spaceBelow = floor - rect.bottom - 8
    const spaceAbove = rect.top - 8
    // The panel's whole height (scrollHeight ignores the max-height cap): open on the side that holds all of it, below first; the cap only bites when neither does.
    const needed = Math.min(cap, panelRef.current?.scrollHeight ?? 0)
    const style: CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
    }
    const below = needed <= spaceBelow || (needed > spaceAbove && spaceBelow >= spaceAbove)
    let max = Math.min(cap, below ? spaceBelow : spaceAbove)
    const row = panelRef.current?.querySelector<HTMLElement>('[role="option"]')?.offsetHeight
    if (maxPanelHeight !== undefined && row && (panelRef.current?.scrollHeight ?? 0) > max) max = Math.floor(max / row - 0.5) * row + row / 2
    if (below) style.top = rect.bottom + 8
    else style.bottom = window.innerHeight - rect.top + 8
    style.maxHeight = max
    style.overflowY = 'auto'
    if (resolvedAlign === 'left') {
      style.left = rect.left
      if (variant === 'form') style.width = rect.width
    } else {
      style.right = window.innerWidth - rect.right
    }
    setPanelStyle(style)
  }, [resolvedAlign, variant, maxPanelHeight])

  // Position the portal panel relative to the trigger on open,
  // and reposition on scroll / resize so it tracks the trigger.
  useEffect(() => {
    if (!open) return
    updatePosition()

    // Listen on window (captures page-level scroll) and use capture
    // phase to catch scrolls inside overflow containers (modals, panels).
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  // Click-outside: close if click is outside both trigger container AND portal panel
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      const inContainer = containerRef.current?.contains(target)
      const inPanel = panelRef.current?.contains(target)
      if (!inContainer && !inPanel) {
        setOpen(false)
        setFocusedIndex(-1)
        onBlurRef.current?.()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Auto-focus search input when panel opens in searchable mode
  useEffect(() => {
    if (open && searchable && searchRef.current) {
      // preventScroll: the panel is still unstyled at the end of body here, and focusing it would scroll the window.
      searchRef.current.focus({ preventScroll: true })
    }
  }, [open, searchable])

  // Reset search query and position when panel closes (the panel unmounts, so no exit transition to flash): the next open positions first, then scrolls.
  useEffect(() => {
    if (!open) {
      setSearchQuery('')
      setPanelStyle({})
    }
  }, [open])

  // The panel scrolls past maxPanelHeight: keep the active row in view (a no-op when it already is, so hover is harmless). jsdom lacks scrollIntoView.
  useEffect(() => {
    // Wait for the position: scrolling while the panel is still static at the end of body scrolls the window.
    if (!open || focusedIndex < 0 || panelStyle.position !== 'fixed') return
    panelRef.current?.querySelectorAll('[role="option"]')[focusedIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, focusedIndex, panelStyle.position])

  // Reset focusedIndex when query changes
  useEffect(() => {
    setFocusedIndex(-1)
  }, [searchQuery])

  const visibleItems = searchable && searchQuery
    ? items.filter(item => item.value !== '' && item.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : items

  const handleSelect = (item: DropdownItem) => {
    if (item.disabled) return
    if (variant === 'menu' || variant === 'icon') {
      onSelect?.(item.value)
    } else {
      onChange?.(item.value)
      onBlur?.()
    }
    setOpen(false)
    setFocusedIndex(-1)
    // Belt-and-suspenders alongside the option rows' onMouseDown preventDefault below: a mouse
    // click on an option would otherwise blur the trigger button (the browser blurs on
    // mousedown, before the click that commits the selection fires) and strand focus nowhere.
    triggerRef.current?.focus()
  }

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setFocusedIndex(-1)
      setSearchQuery('')
      onBlur?.()
      triggerRef.current?.focus()
      return
    }
    const enabledIndices = visibleItems
      .map((item, i) => (item.disabled ? -1 : i))
      .filter(i => i !== -1)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const pos = enabledIndices.indexOf(focusedIndex)
      const next = pos === -1 ? enabledIndices[0] : enabledIndices[(pos + 1) % enabledIndices.length]
      if (next !== undefined) setFocusedIndex(next)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const pos = enabledIndices.indexOf(focusedIndex)
      const prev = pos === -1
        ? enabledIndices[enabledIndices.length - 1]
        : enabledIndices[(pos - 1 + enabledIndices.length) % enabledIndices.length]
      if (prev !== undefined) setFocusedIndex(prev)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const focused = focusedIndex >= 0 ? visibleItems[focusedIndex] : null
      const target = focused ?? (visibleItems.length === 1 && !visibleItems[0]?.disabled ? visibleItems[0] : null)
      if (target) handleSelect(target)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || loading) return

    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setOpen(true)
        // Open on the chosen row so Enter, Enter keeps the current choice; no choice, the first enabled row.
        const chosen = visibleItems.findIndex(i => !i.disabled && i.value === value)
        const first = chosen >= 0 ? chosen : visibleItems.findIndex(i => !i.disabled)
        setFocusedIndex(first >= 0 ? first : 0)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setFocusedIndex(-1)
      onBlur?.()
      triggerRef.current?.focus()
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      setFocusedIndex(-1)
      onBlur?.()
      return
    }

    const enabledIndices = visibleItems
      .map((item, i) => (item.disabled ? -1 : i))
      .filter(i => i !== -1)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const pos = enabledIndices.indexOf(focusedIndex)
      const next = enabledIndices[(pos + 1) % enabledIndices.length]
      setFocusedIndex(next ?? 0)
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const pos = enabledIndices.indexOf(focusedIndex)
      const prev = enabledIndices[(pos - 1 + enabledIndices.length) % enabledIndices.length]
      setFocusedIndex(prev ?? 0)
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (focusedIndex === -1) {
        const first = visibleItems.findIndex(i => !i.disabled)
        if (first >= 0) setFocusedIndex(first)
        return
      }
      const focused = visibleItems[focusedIndex]
      if (focused && !focused.disabled) handleSelect(focused)
    }
  }

  const selectedLabel = items.find(i => i.value === value)?.label

  const chevron =
    loading && variant !== 'menu' ? (
      <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
    ) : (
      <ChevronDown
        className={`w-3.5 h-3.5 transition-transform duration-200 shrink-0 ${open ? 'rotate-180' : ''}`}
      />
    )

  const panelWidthClass = variant === 'pill' ? 'min-w-[10rem]' : variant === 'menu' || variant === 'icon' ? 'w-56' : ''

  const panel = open && createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="listbox"
      style={panelStyle}
      className={`bg-[var(--color-popover)] rounded-md shadow-[var(--shadow-float)] ${panelWidthClass}`}
    >
      {searchable && (
        <div className="p-2">
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            className="w-full px-3 py-1.5 text-sm bg-[var(--color-input)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
      {visibleItems.length === 0 ? (
        <p role="presentation" className="px-4 py-3 text-sm text-[var(--color-muted-foreground)] opacity-50">
          {searchable && searchQuery ? 'No results found' : 'No options available'}
        </p>
      ) : (
        visibleItems.map((item, idx) => (
          <div key={item.value}>
            {variant === 'menu' && idx > 0 && item.description && (
              <div className="h-px bg-[var(--color-border)]/25 mx-4" />
            )}
            <div
              role="option"
              id={`dd-opt-${item.value}`}
              aria-selected={variant !== 'menu' ? item.value === value : undefined}
              aria-disabled={item.disabled ? 'true' : undefined}
              // Prevents the browser's default mousedown-blur: without this, clicking an option
              // blurs the trigger button before the click event that commits the selection ever
              // fires, stranding DOM focus outside the component. See handleSelect's re-focus
              // for the belt-and-suspenders half of this (W3C APG / Downshift combobox pattern).
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => !item.disabled && setFocusedIndex(idx)}
              // min-h --tap-min: 44px rows under a coarse pointer (a phone's row actions live here), 0px and so unchanged on a mouse.
              className={`w-full min-h-[var(--tap-min)] flex items-center gap-3 px-3 py-1.5 text-sm text-[var(--color-foreground)] text-left transition-colors ${
                item.disabled
                  ? `cursor-not-allowed ${item.description ? '' : 'opacity-40'}`
                  : focusedIndex === idx
                  ? 'bg-[var(--color-surface-container-low)]'
                  : 'hover:bg-[var(--color-surface-container-low)]'
              }`}
            >
              {item.icon && <span className={`shrink-0 ${item.disabled && item.description ? 'opacity-40' : ''}`}>{item.icon}</span>}
              <div className="min-w-0">
                {/* A disabled item with a reason dims the label and icon: the reason is the one place that says why, so it keeps its contrast. */}
                <p className={item.description ? `font-semibold ${item.disabled ? 'opacity-40' : ''}` : ''}>{item.label}</p>
                {item.description && (
                  <p className="text-[13px] text-[var(--color-muted-foreground)]">{item.description}</p>
                )}
              </div>
              {/* Icon variant with a value: the chosen row wears a check (aria-selected already announces it). */}
              {variant === 'icon' && item.value === value && <Check className="ml-auto w-4 h-4 shrink-0" aria-hidden="true" />}
            </div>
          </div>
        ))
      )}
    </div>,
    document.body
  )

  // ── pill variant ──────────────────────────────────────────────────────────
  if (variant === 'pill') {
    return (
      <div className="relative inline-flex items-center" ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          aria-haspopup="listbox"
          aria-controls={panelId}
          aria-expanded={open}
          aria-labelledby={ariaLabelledBy}
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-activedescendant={open && focusedIndex >= 0 ? `dd-opt-${visibleItems[focusedIndex]?.value}` : undefined}
          disabled={disabled || loading}
          onClick={() => setOpen(v => !v)}
          onKeyDown={handleKeyDown}
          className={`${TAP_AREA} text-xs pl-2.5 pr-6 py-1 rounded-full font-medium cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] hover:shadow-[0_0_0_2px_var(--color-focus-ring-soft)] disabled:opacity-60 disabled:pointer-events-none ${colorClass}`}
        >
          {selectedLabel ?? label ?? '—'}
        </button>
        <span className="absolute right-1.5 pointer-events-none opacity-60">
          {chevron}
        </span>
        {panel}
      </div>
    )
  }

  // ── form variant ──────────────────────────────────────────────────────────
  if (variant === 'form') {
    return (
      <div className="relative w-full" ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          aria-haspopup="listbox"
          aria-controls={panelId}
          aria-expanded={open}
          aria-labelledby={ariaLabelledBy}
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-activedescendant={open && focusedIndex >= 0 ? `dd-opt-${visibleItems[focusedIndex]?.value}` : undefined}
          disabled={disabled || loading}
          onClick={() => setOpen(v => !v)}
          onKeyDown={handleKeyDown}
          className="w-full flex items-center justify-between h-[var(--control-h)] px-3 rounded-[var(--radius-sm)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] hover:shadow-[0_0_0_2px_var(--color-focus-ring-soft)] transition-all disabled:opacity-60 disabled:pointer-events-none bg-[var(--color-input)] text-[var(--color-foreground)]"
        >
          <span className={selectedLabel ? '' : 'opacity-50 text-[var(--color-muted-foreground)]'}>
            {selectedLabel ?? label ?? 'Select…'}
          </span>
          {chevron}
        </button>
        {panel}
      </div>
    )
  }

  // ── icon variant ──────────────────────────────────────────────────────────
  if (variant === 'icon') {
    return (
      <div className="relative inline-flex" ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={label ?? 'More actions'}
          aria-activedescendant={open && focusedIndex >= 0 ? `dd-opt-${visibleItems[focusedIndex]?.value}` : undefined}
          disabled={disabled || loading}
          onClick={() => setOpen(v => !v)}
          onKeyDown={handleKeyDown}
          // No TAP_AREA on the icon trigger, on purpose. The default look (a roster ShiftChip's "Actions" kebab)
          // sits flush against the chip body and the drag handle, so a 44px pad would take the chip's own right
          // edge under coarse — a pad must never overlap a neighbouring control. A header icon with room for
          // one passes triggerClassName.
          className={triggerClassName ?? 'p-1.5 rounded-lg hover:bg-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:opacity-40 disabled:pointer-events-none transition-colors'}
        >
          {icon}
        </button>
        {panel}
      </div>
    )
  }

  // ── menu variant ──────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-controls={panelId}
        aria-expanded={open}
        aria-labelledby={ariaLabelledBy}
        aria-required={ariaRequired}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-activedescendant={open && focusedIndex >= 0 ? `dd-opt-${visibleItems[focusedIndex]?.value}` : undefined}
        disabled={disabled || loading}
        onClick={() => setOpen(v => !v)}
        onKeyDown={handleKeyDown}
        // An md Button (primary is the header-action standard), 44px on a touch screen like any md Button, so no pad.
        className={buttonClasses(triggerVariant, 'md', false, iconOnlyBelowSm ? 'max-sm:w-[var(--control-h)] max-sm:px-0' : undefined)}
      >
        {icon}
        {iconOnlyBelowSm ? <span className="sr-only sm:not-sr-only">{label}</span> : label}
        {iconOnlyBelowSm ? <span className="hidden sm:contents">{chevron}</span> : chevron}
      </button>
      {panel}
    </div>
  )
}
