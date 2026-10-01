import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Source-scanning guards for SlideOver and useDialogBehavior, in the house style of detailScaffolding.test.ts: each rule is a
// property of the source, so it fails at the file that breaks it.
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full)
  }
  return files
}

const FILES = sourceFiles(SRC_DIR).map(full => ({ path: relative(SRC_DIR, full).split('\\').join('/'), text: readFileSync(full, 'utf-8') }))
const offendersOf = (test: (text: string) => boolean, allowed: string[] = []) =>
  FILES.filter(f => test(f.text) && !allowed.includes(f.path)).map(f => f.path)
const textOf = (path: string) => FILES.find(f => f.path === path)?.text ?? ''

/** The nine side panels that used to hand-roll `fixed right-0 top-0 ... z-50` over a `bg-black/40` scrim. */
const PANELS = [
  'components/TemplateFormPanel.tsx',
  'pages/billing/BillableEventFormPanel.tsx',
  'pages/billing/FundingSourceFormPanel.tsx',
  'pages/billing/ServiceBookingFormPanel.tsx',
  'pages/rostering/components/ExceptionsDrawer.tsx',
  'pages/rostering/components/PatternSlideOver.tsx',
  'pages/rostering/components/ShiftSlideOver.tsx',
  'pages/settings/TenantFormPanel.tsx',
  'pages/settings/UserFormPanel.tsx',
]

describe('SlideOver', () => {
  it('is how every side panel is built: each of the nine renders a SlideOver and draws no scrim or fixed panel of its own', () => {
    for (const path of PANELS) {
      const text = textOf(path)
      expect(text, `${path} should render <SlideOver`).toMatch(/<SlideOver\b/)
      expect(text, `${path} draws its own panel`).not.toMatch(/fixed right-0 top-0/)
      expect(text, `${path} draws its own scrim`).not.toMatch(/fixed inset-0[^'"]*bg-black\/40|bg-black\/40[^'"]*fixed inset-0/)
    }
  })

  it('is the only home of the panel geometry: no other file spells out a right-docked z-50 panel', () => {
    expect(offendersOf(text => /fixed right-0 top-0/.test(text), ['components/SlideOver.tsx'])).toEqual([])
  })

  it('left no roster-only copy of the dialog behaviour behind', () => {
    expect(existsSync(join(SRC_DIR, 'pages/rostering/lib/useSlideOverA11y.ts'))).toBe(false)
    expect(offendersOf(text => /useSlideOverA11y/.test(text))).toEqual([])
  })
})

describe('useDialogBehavior', () => {
  it('is the one place that locks page scroll and defines the focusable selector', () => {
    expect(offendersOf(text => /document\.body\.style\.overflow\s*=/.test(text), ['hooks/useDialogBehavior.ts'])).toEqual([])
    expect(offendersOf(text => /const FOCUSABLE_SELECTOR\s*=/.test(text), ['hooks/useDialogBehavior.ts'])).toEqual([])
  })

  it('is what Modal, SlideOver, EditTripModal and the unsaved-changes dialog run on', () => {
    for (const path of ['components/Modal.tsx', 'components/SlideOver.tsx', 'pages/trip-detail/EditTripModal.tsx', 'hooks/useUnsavedChangesWarning.tsx']) {
      expect(textOf(path), `${path} should call useDialogBehavior`).toMatch(/useDialogBehavior\(/)
    }
  })

  /**
   * A dialog answers Escape through the hook, so a stacked dialog closes alone. These are the Escape handlers still written by hand,
   * and why each may stay: the list is a ratchet: no new one may appear, and a file that moved onto the hook leaves it.
   *   Dropdown, SearchableSelect: an open list closing itself (they call preventDefault, which the hook respects).
   *   TenantSwitcher, UserSwitcher: header popovers, not dialogs.
   *   AppLayout: the nav drawer, which adopts the hook in the nav regroup (components/README.md, "useDialogBehavior").
   */
  const KNOWN_ESCAPE_HANDLERS: Record<string, number> = {
    'components/Dropdown.tsx': 2,
    'components/SearchableSelect.tsx': 1,
    'components/layout/AppLayout.tsx': 1,
    'components/layout/TenantSwitcher.tsx': 1,
    'components/layout/UserSwitcher.tsx': 1,
    'hooks/useDialogBehavior.ts': 1,
  }
  const found: Record<string, number> = {}
  for (const f of FILES) {
    const count = (f.text.match(/key === ['"]Escape['"]/g) ?? []).length
    if (count) found[f.path] = count
  }

  it('leaves no new hand-written Escape handler: use the hook', () => {
    for (const [path, count] of Object.entries(found)) {
      expect(count, `${path} handles Escape ${count} time(s) by hand; run the layer on useDialogBehavior`).toBeLessThanOrEqual(KNOWN_ESCAPE_HANDLERS[path] ?? 0)
    }
  })

  it('keeps that list honest: a file that dropped its handler is taken off it', () => {
    for (const [path, count] of Object.entries(KNOWN_ESCAPE_HANDLERS)) {
      expect(found[path] ?? 0, `${path} no longer has that many Escape handlers: lower or remove its entry`).toBe(count)
    }
  })

  it('aria-modal appears only on dialogs that run on the hook', () => {
    const allowed = ['components/Modal.tsx', 'components/SlideOver.tsx', 'hooks/useUnsavedChangesWarning.tsx', 'pages/trip-detail/EditTripModal.tsx']
    expect(offendersOf(text => /aria-modal=/.test(text), allowed)).toEqual([])
    for (const path of allowed) expect(textOf(path), `${path} marks itself modal, so it must run on the hook`).toMatch(/useDialogBehavior\(/)
  })
})
