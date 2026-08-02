import { useState, useRef, useEffect, useCallback } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

export type DropdownItem = {
  value: string
  label: string
  icon?: ReactNode
  description?: string
  disabled?: boolean
}

type DropdownProps = {
  variant: 'pill' | 'form' | 'menu'
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
  colorClass?: string       // Tailwind color classes for pill trigger background
  disabled?: boolean        // caller controls — not auto-applied on empty items
  loading?: boolean

  // Panel alignment — default varies by variant: pill='right', form='left', menu='right'
  align?: 'left' | 'right'
  searchable?: boolean
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
  colorClass = '',
  disabled = false,
  loading = false,
  align,
  searchable = false,
}: DropdownProps) {
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
    const maxPanelHeight = 320
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const style: CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
    }
    if (spaceBelow >= spaceAbove || spaceBelow >= 120) {
      style.top = rect.bottom + 8
      style.maxHeight = Math.min(maxPanelHeight, spaceBelow)
    } else {
      style.bottom = window.innerHeight - rect.top + 8
      style.maxHeight = Math.min(maxPanelHeight, spaceAbove)
    }
    style.overflowY = 'auto'
    if (resolvedAlign === 'left') {
      style.left = rect.left
      if (variant === 'form') style.width = rect.width
    } else {
      style.right = window.innerWidth - rect.right
    }
    setPanelStyle(style)
  }, [resolvedAlign, variant])

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
      searchRef.current.focus()
    }
  }, [open, searchable])

  // Reset search query when panel closes
  useEffect(() => {
    if (!open) setSearchQuery('')
  }, [open])

  // Reset focusedIndex when query changes
  useEffect(() => {
    setFocusedIndex(-1)
  }, [searchQuery])

  const visibleItems = searchable && searchQuery
    ? items.filter(item => item.value !== '' && item.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : items

  const handleSelect = (item: DropdownItem) => {
    if (item.disabled) return
    if (variant === 'menu') {
      onSelect?.(item.value)
    } else {
      onChange?.(item.value)
      onBlur?.()
    }
    setOpen(false)
    setFocusedIndex(-1)
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
        const first = visibleItems.findIndex(i => !i.disabled)
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

  const panelWidthClass = variant === 'pill' ? 'min-w-[10rem]' : variant === 'menu' ? 'w-56' : ''

  const panel = open && createPortal(
    <div
      ref={panelRef}
      role="listbox"
      style={panelStyle}
      className={`bg-white rounded-2xl shadow-[0_24px_40px_-12px_rgba(27,28,26,0.14)] ${panelWidthClass}`}
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
            className="w-full px-3 py-1.5 text-sm bg-[var(--color-input)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#396200]/25"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
      {visibleItems.length === 0 ? (
        <p role="presentation" className="px-4 py-3 text-sm text-[#43493a] opacity-50">
          {searchable && searchQuery ? 'No results found' : 'No options available'}
        </p>
      ) : (
        visibleItems.map((item, idx) => (
          <div key={item.value}>
            {variant === 'menu' && idx > 0 && item.description && (
              <div className="h-px bg-[rgba(195,201,181,0.25)] mx-4" />
            )}
            <div
              role="option"
              id={`dd-opt-${item.value}`}
              aria-selected={variant !== 'menu' ? item.value === value : undefined}
              aria-disabled={item.disabled ? 'true' : undefined}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => !item.disabled && setFocusedIndex(idx)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-[#1b1c1a] text-left transition-colors ${
                item.disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : focusedIndex === idx
                  ? 'bg-[#f5f3ef]'
                  : 'hover:bg-[#f5f3ef]'
              }`}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <div className="min-w-0">
                <p className={item.description ? 'font-semibold' : ''}>{item.label}</p>
                {item.description && (
                  <p className="text-[11px] text-[#43493a]">{item.description}</p>
                )}
              </div>
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
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-activedescendant={open && focusedIndex >= 0 ? `dd-opt-${visibleItems[focusedIndex]?.value}` : undefined}
          disabled={disabled || loading}
          onClick={() => setOpen(v => !v)}
          onKeyDown={handleKeyDown}
          className={`text-xs pl-2.5 pr-6 py-1 rounded-full font-medium cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-[#396200]/25 hover:shadow-[0_0_0_2px_rgba(57,98,0,0.18)] disabled:opacity-60 disabled:pointer-events-none ${colorClass}`}
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
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-activedescendant={open && focusedIndex >= 0 ? `dd-opt-${visibleItems[focusedIndex]?.value}` : undefined}
          disabled={disabled || loading}
          onClick={() => setOpen(v => !v)}
          onKeyDown={handleKeyDown}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#396200]/25 hover:shadow-[0_0_0_2px_rgba(57,98,0,0.18)] transition-all disabled:opacity-60 disabled:pointer-events-none bg-[var(--color-input)] text-[var(--color-foreground)]"
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

  // ── menu variant ──────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={open && focusedIndex >= 0 ? `dd-opt-${visibleItems[focusedIndex]?.value}` : undefined}
        disabled={disabled || loading}
        onClick={() => setOpen(v => !v)}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-2 px-5 py-2.5 text-sm bg-gradient-to-br from-[#396200] to-[#4d7c0f] text-white rounded-full font-bold shadow-lg shadow-[#396200]/20 hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {icon}
        {label}
        {chevron}
      </button>
      {panel}
    </div>
  )
}
