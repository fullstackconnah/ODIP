import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Source-scanning guards for the detail-page scaffolding (BackButton, PageState, useTabParam), in the house style of
// focusRingTokens.test.ts: each rule is a property of the source, so it fails at the line that breaks it.
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

describe('BackButton', () => {
  it('owns useBackTarget: no page calls it, so no hook can sit below an early return (the #155 class of bug)', () => {
    expect(offendersOf(text => /\buseBackTarget\(/.test(text), ['hooks/useBackNavigation.tsx', 'components/BackButton.tsx'])).toEqual([])
  })

  it('is the only file that draws a Back arrow: no page imports ArrowLeft to hand-roll one', () => {
    expect(offendersOf(text => /import\s*\{[^}]*\bArrowLeft\b[^}]*\}\s*from\s*'lucide-react'/.test(text), ['components/BackButton.tsx'])).toEqual([])
  })
})

// Every record page and tab the scaffolding work touched: its early returns go through PageState, so a loading, failed or missing record
// reads the same on all of them (and a failure is never reported as "not found").
const PAGE_STATE_SITES = [
  'pages/TripDetailPage.tsx',
  'pages/StaffDetailPage.tsx',
  'pages/AccommodationDetailPage.tsx',
  'pages/IncidentDetailPage.tsx',
  'pages/ParticipantDetailPage.tsx',
  'pages/ClaimDetailPage.tsx',
  'pages/OnboardingDetailPage.tsx',
  'pages/caregiver-admin/CaregiverSubmissionReviewPage.tsx',
  'pages/participant-detail/MedicationsTab.tsx',
  'pages/participant-detail/SupportProfileTab.tsx',
  'components/ItineraryTab.tsx',
]

describe('PageState', () => {
  it.each(PAGE_STATE_SITES)('%s early-returns through PageState, with no hand-rolled "Loading..." or "not found" placeholder', (path) => {
    const file = FILES.find(f => f.path === path)
    expect(file, `${path} should exist`).toBeDefined()
    expect(file!.text).toMatch(/from '[^']*PageState'/)
    expect(file!.text).not.toMatch(/>\s*Loading[^<]*(\.\.\.|…)\s*</)
    expect(file!.text).not.toMatch(/>[^<>{}]*\bnot found\.?\s*</i)
  })

  it('a page that reports a failure separately from a missing record also routes a 404 to "not found"', () => {
    // The detail endpoints answer 404 for an unknown id, and react-query reports that as an error, so every page that renders
    // kind="error" for a record must ask isNotFoundError first. (The tabs below it have no "no such record" of their own.)
    const pages = PAGE_STATE_SITES.filter(path => path.startsWith('pages/') && !path.includes('MedicationsTab'))
    for (const path of pages) {
      const text = FILES.find(f => f.path === path)!.text
      expect(text, `${path} should import isNotFoundError`).toContain('isNotFoundError')
    }
  })
})

describe('useTabParam', () => {
  it('is the only code that reads or writes ?tab= for a page tab: no page keeps its own copy of the logic', () => {
    // useBackNavigation only PARSES a path string to name a hub tab for its accessible label; it never reads the live URL.
    expect(offendersOf(text => /\.get\(['"]tab['"]\)/.test(text), ['hooks/useTabParam.ts', 'hooks/useBackNavigation.tsx'])).toEqual([])
  })

  it.each(['pages/TripDetailPage.tsx', 'pages/ParticipantDetailPage.tsx', 'pages/StaffDetailPage.tsx', 'pages/ParticipantsHubPage.tsx'])(
    '%s keeps its active tab in the URL through useTabParam',
    (path) => {
      expect(FILES.find(f => f.path === path)!.text).toContain('useTabParam(')
    },
  )
})
