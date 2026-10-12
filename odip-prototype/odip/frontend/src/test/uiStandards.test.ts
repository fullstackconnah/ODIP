import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

/**
 * UI standards 2, 3, 4 and 8 (the UI survey, section 10), as a source scan of src/pages and src/components:
 *   colour   no literal colour: a #hex, rgb()/rgba(), a Tailwind palette colour (`bg-red-100`) or `bg-white`. Use the index.css tokens and
 *            lib/tone.ts. Exempt: ItineraryPdf.tsx (a PDF stylesheet; react-pdf cannot read CSS variables).
 *   button   no <button> or <Link> painted `bg-[var(--color-primary)]`: an action is a `Button` (`to=` for a link).
 *   overlay  no `fixed inset-0` or `role="dialog"` outside Modal, SlideOver and the AppLayout nav drawer.
 *   format   no `$` followed by `.toFixed(2)` (use formatCurrency) and no `toLocaleDateString()` without a locale (use formatDateAu).
 * Comment lines are skipped. Each count is a RATCHET: a file may not go over its baseline, and once a file drops below it the
 * baseline has to come down with it, so the number only ever falls.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const FILES = [...sourceFiles(join(SRC, 'pages')), ...sourceFiles(join(SRC, 'components'))].map(full => ({
  path: relative(SRC, full).split(sep).join('/'),
  // Comments go (block comments, then comment lines), so a comment may name the hex a token stands for.
  code: readFileSync(full, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(line => !/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line)).join('\n'),
}))

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const COLOUR = new RegExp(
  String.raw`(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|(?<![a-zA-Z])rgba?\(|\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide|placeholder|decoration|shadow|accent|caret)-(?:${PALETTE})-\d{2,3}\b|\bbg-white\b`,
  'g',
)
// An opening tag; `=>` inside an attribute does not end it.
const ACTION_TAG = /<(?:button|Link)\b(?:=>|[^>])*>/g

type Rule = 'colour' | 'button' | 'overlay' | 'format'

const COUNT: Record<Rule, (code: string) => number> = {
  colour: code => code.match(COLOUR)?.length ?? 0,
  // A toggle (aria-pressed, aria-checked, role="switch") shows its ON state in the primary fill; it is not an action, and Button is no toggle.
  button: code => (code.match(ACTION_TAG) ?? [])
    .filter(tag => /bg-\[var\(--color-primary\)\](?![/\w])/.test(tag) && !/aria-pressed|aria-checked|role="switch"/.test(tag)).length,
  overlay: code => code.match(/fixed inset-0|role="dialog"/g)?.length ?? 0,
  format: code => code.match(/\$\$?\{[^}\n]*\.toFixed\(2\)|toLocaleDateString\(\s*\)/g)?.length ?? 0,
}

const EXEMPT: Record<Rule, string[]> = {
  colour: ['components/ItineraryPdf.tsx'],
  button: ['components/Button.tsx'],
  overlay: ['components/Modal.tsx', 'components/SlideOver.tsx', 'components/layout/AppLayout.tsx'],
  format: ['components/ItineraryPdf.tsx'],
}

/** What is left, file by file, and why it may stay. Lower a number when you remove one; never raise it. */
const BASELINE: Record<Rule, Record<string, number>> = {
  // Each one is the rgba() tint of a `shadow-[...]` (the DESIGN ambient shadow, 27,28,26 = --color-foreground, and Dropdown's primary
  // hover ring): index.css has no shadow tokens yet. Add them there and these go.
  colour: {
    'components/Dropdown.tsx': 3,
    'components/ItineraryTab.tsx': 1,
    'components/SearchableSelect.tsx': 1,
    'components/layout/AppLayout.tsx': 2,
    'pages/LoginPage.tsx': 2,
    'pages/TripsPage.tsx': 1,
  },
  button: {
    // The Active switch has no role="switch" / aria-checked yet (UserFormPanel's twin has both); it is a toggle, not an action.
    'pages/settings/TenantFormPanel.tsx': 1,
  },
  overlay: {},
  format: {},
}

describe('UI standards source scan', () => {
  it('scans the source (not silently empty)', () => {
    expect(FILES.length).toBeGreaterThan(200)
    expect(COUNT.colour('bg-[#fef3c7] text-red-500 bg-white rgba(0,0,0,0) shadow-[0_1px_2px_rgba(0,0,0,0.1)] &#9888;')).toBe(5)
    expect(COUNT.button('<Link to="/x" className="bg-[var(--color-primary)] text-white">')).toBe(1)
    expect(COUNT.button('<button className="bg-[var(--color-primary)]/10" onClick={() => go()}>')).toBe(0)
    expect(COUNT.button('<button aria-pressed={on} className={on ? "bg-[var(--color-primary)]" : ""}>')).toBe(0)
    expect(COUNT.format('<b>${x.toFixed(2)}</b> `$${y.toFixed(2)}` d.toLocaleDateString() d.toLocaleDateString(\'en-AU\')')).toBe(3)
  })

  for (const rule of Object.keys(COUNT) as Rule[]) {
    it(`${rule}: no file goes over its baseline, and the baseline matches what is left`, () => {
      const found: Record<string, number> = {}
      for (const { path, code } of FILES) {
        if (EXEMPT[rule].includes(path)) continue
        const n = COUNT[rule](code)
        if (n > 0) found[path] = n
      }
      expect(found).toEqual(BASELINE[rule])
    })
  }
})
