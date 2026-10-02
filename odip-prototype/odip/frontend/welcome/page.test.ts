import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import indexHtml from './index.html?raw'
import appIndexHtml from '../index.html?raw'
import manifestRaw from './assets/screens/manifest.json?raw'

// CSS is read from disk: the test run does not process CSS (vite.config.ts `css: false`).
const css = readFileSync(join(__dirname, 'welcome.css'), 'utf-8')

// Guards for the landing page's contract: the direction it was built to, the CSP it must satisfy, the claims it must
// never make (PRODUCT-TRUTH and both finish reviews), and the proof it must show.
const doc = new DOMParser().parseFromString(indexHtml, 'text/html')
const manifest = JSON.parse(manifestRaw) as Array<{ name: string; file1x: string; width1x: number; height1x: number }>
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const visibleText = (() => {
  const clone = doc.body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, svg, .sr-only').forEach((n) => n.remove())
  return squash(clone.textContent)
})()
const altText = Array.from(doc.querySelectorAll('img')).map((i) => i.getAttribute('alt') ?? '').join(' ')
const attrText = Array.from(doc.querySelectorAll('[aria-label], [title], [data-arrived]'))
  .map((el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-arrived')].join(' '))
  .join(' ')
const words = `${visibleText} ${altText} ${attrText} ${doc.title} ${doc.querySelector('meta[name="description"]')?.getAttribute('content')}`
const fileOf = (url: string | null) => (url ?? '').split(' ')[0].split('/').pop()!

describe('direction contract', () => {
  const comment = indexHtml.match(/^\s*<!--([\s\S]*?)-->/)

  it('opens the file, ahead of the doctype, so it survives the build', () => {
    expect(comment).not.toBeNull()
    expect(indexHtml.indexOf('<!--')).toBe(0)
    expect(indexHtml.indexOf('<!doctype html>')).toBeGreaterThan(indexHtml.indexOf('-->'))
  })

  it('carries the five blocks in order and closes with the FINISH line verbatim', () => {
    const body = comment![1].trim()
    const order = ['THESIS:', 'OWN-WORLD:', 'STORY:', 'FIRST VIEWPORT:', 'FORM:', 'FINISH:'].map((k) => body.indexOf(k))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(body).toContain('THESIS: Odip is where the lived trip becomes the record.')
    expect(body).toContain('FORM: fused shader-portal challenger; staging: translation gate; seed 89fb77e6.')
    expect(body.split('\n').pop()!.trim()).toBe(
      'FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md',
    )
  })
})

describe('CSP: what the page may load', () => {
  const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!
  const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '))

  it('allows same-origin scripts only, and the page has no inline script or handler', () => {
    expect(directive('script-src')).toBe("script-src 'self'")
    const scripts = Array.from(doc.querySelectorAll('script'))
    expect(scripts.length).toBeGreaterThan(0)
    for (const s of scripts) {
      expect(s.getAttribute('src'), 'every script is an external file').toBeTruthy()
      expect(s.getAttribute('src')).not.toMatch(/^(https?:)?\/\//)
    }
    expect(doc.querySelectorAll('[onclick], [onload], [onerror], [onsubmit]').length).toBe(0)
  })

  it('images only from self, data: or blob:; fetch only to self; fonts from Google Fonts', () => {
    expect(directive('img-src')).toBe("img-src 'self' data: blob:")
    expect(directive('connect-src')).toBe("connect-src 'self'")
    expect(directive('font-src')).toBe("font-src 'self' https://fonts.gstatic.com")
    expect(directive('style-src')).toContain('https://fonts.googleapis.com')
    expect(directive('form-action')).toBe("form-action 'self'")
    expect(directive('object-src')).toBe("object-src 'none'")
  })

  it('every image ships with the site, the poster included, and every stylesheet is Google Fonts or local', () => {
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      expect(img.getAttribute('src')).not.toMatch(/^(https?:)?\/\//)
      expect(img.getAttribute('srcset') ?? '').not.toMatch(/https?:\/\//)
    }
    for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
      expect(link.getAttribute('href')).toMatch(/^(\.\/|https:\/\/fonts\.googleapis\.com\/)/)
    }
    expect(css).toMatch(/url\('\.\/assets\/canopy-poster\.webp'\)/)
    expect(css).not.toMatch(/url\((['"])?https?:/)
  })
})

describe('the app\'s own type: the same two families as the app, critical files preloaded', () => {
  it('loads Plus Jakarta Sans and Manrope, as the app does, and no other family', () => {
    const href = doc.querySelector('link[rel="stylesheet"][href^="https://fonts.googleapis.com"]')!.getAttribute('href')!
    const families = [...href.matchAll(/family=([^:&]+)/g)].map((m) => m[1].replace(/\+/g, ' '))
    expect(families).toEqual(['Plus Jakarta Sans', 'Manrope'])
    for (const f of families) expect(appIndexHtml).toContain(`family=${f.replace(/ /g, '+')}`)
  })

  it('preloads only the two Latin woff2 files, crossorigin, from fonts.gstatic.com', () => {
    const preloads = Array.from(doc.querySelectorAll('link[rel="preload"][as="font"]'))
    expect(preloads.map((l) => l.getAttribute('href')!.split('/s/')[1].split('/')[0])).toEqual(['plusjakartasans', 'manrope'])
    for (const l of preloads) {
      expect(l.getAttribute('href')).toMatch(/^https:\/\/fonts\.gstatic\.com\/s\/.+\.woff2$/)
      expect(l.hasAttribute('crossorigin')).toBe(true)
    }
  })
})

describe('claims: only what PRODUCT-TRUTH and the finish reviews allow', () => {
  it('never says "compliant" anywhere in the page, not even in a file name', () => {
    expect(indexHtml).not.toMatch(/complian/i)
  })

  it.each([
    ['third-party integrations', /xero|brevity|employment hero|splose|linxio|budgetly/i],
    ['connecting to or submitting to PRODA or the Commission', /(connects?|integrat\w*|submits?|syncs?) (with |to )?(proda|the ndis commission|ndia)/i],
    ['a 5-day rule or live countdown timers', /5[- ]day|five[- ]day|countdown|count-down|live timer/i],
    ['a complaints register', /complaints? (register|management)/i],
    ['offline mode or a PWA', /offline|\bpwa\b|installable|install the app/i],
    ['Australian data hosting or residency', /data residency|hosted in australia|australian[- ]hosted|australian data/i],
    ['e-signing', /e-?sign/i],
    ['payment reconciliation', /reconcil/i],
    ['SMS', /\bsms\b|text message/i],
    ['per-traveller bed or room allocation', /(allocate|assign)s? (each )?(traveller|participant)s? (to )?(a )?(bed|room)/i],
    ['customers, testimonials, pricing or ratings', /testimonial|customers? (say|love|trust)|per month|\/month|pricing|\$\d+ ?(\/|per)|rated|five stars?|trusted by/i],
    ['every change (25 record types are audited, not everything)', /every change/i],
    ['rooms (the product reserves bed and bedroom counts)', /\brooms?\b/i],
  ])('does not claim %s', (_label, pattern) => {
    expect(words).not.toMatch(pattern)
  })

  it('never uses exclamation-mark hype or scarcity language', () => {
    expect(visibleText).not.toMatch(/!|limited spots|limited places|hurry|don't miss|only \d+ (spots|places)/i)
  })

  it('says what Odip is in the first viewport: software, for NDIS providers that run supported holidays', () => {
    expect(doc.title).toBe('Odip: NDIS trip management for supported holidays')
    expect(doc.querySelector('meta[name="description"]')!.getAttribute('content')).toMatch(
      /^Trip management software for NDIS providers that run supported holidays/,
    )
    expect(squash(doc.querySelector('h1')!.textContent)).toBe('You run the trip. Odip keeps the record.')
    expect(squash(doc.querySelector('.hero__sub')!.textContent)).toBe(
      'Trip management software for NDIS providers that run supported holidays. One record for travellers, accommodation, staff, vehicles and funding, from the first plan to the claims.',
    )
  })

  it('words the shift note as the screen shows it (a keyword prompt), never as detection', () => {
    // ShiftNoteFlagging.cs is advisory: it scans a note for injury words, with false positives and false negatives.
    const fig = Array.from(doc.querySelectorAll('figure')).find((f) => f.querySelector('img')?.getAttribute('src')?.includes('care-shift-notes-phone'))!
    expect(squash(fig.querySelector('figcaption')!.textContent)).toBe('Sample data A shift note that mentions an injury prompts an incident report.')
    expect(visibleText).not.toMatch(/shift notes? (flag|detect)/i)
  })

  it('names QSC once, by its full name, the NDIS Quality and Safeguards Commission', () => {
    expect(visibleText.split('QSC is the NDIS Quality and Safeguards Commission').length - 1).toBe(1)
    expect(visibleText).not.toContain('QSC is the NDIS Commission')
  })

  it('states the roster checks as the code does: two hard stops, and 4 of the 16 warnings need a reason', () => {
    // RosterConflictService.cs: 18 codes; WscExpired and VehicleDoubleBooked block; RequiresReason on four warnings only.
    expect(visibleText).toContain('4 of the 16 warnings need a reason')
    expect(visibleText).not.toMatch(/the rest (ask|need)|all (the )?warnings need/i)
    expect(visibleText).toContain('Expired worker screening and a double-booked vehicle')
  })

  it('times the overdue flag from when the incident was logged, and says Odip exports while the provider uploads', () => {
    expect(visibleText).toContain('still unreported 24 hours after it was logged')
    expect(visibleText).toContain('Odip exports the files; you upload them.')
    expect(visibleText).toContain("Each claim in a batch is checked against its service booking's balance and claim window before you upload")
  })

  it('counts exactly the numbers in the code, and names Oassist as the provider it was built with', () => {
    const readings = Array.from(doc.querySelectorAll('.reading')).map((r) => ({
      n: squash(r.querySelector('.reading__n')!.textContent),
      label: squash(r.querySelector('.reading__label')!.textContent),
    }))
    expect(readings).toEqual([
      { n: '18', label: 'roster checks' },
      { n: '11', label: 'incident types' },
      { n: '5', label: 'credentials tracked' },
      { n: '3', label: 'funding types' },
      { n: '25', label: 'audited record types' },
    ])
    expect(squash(doc.querySelector('.provenance')!.textContent)).toBe('Built with Oassist, a registered NDIS provider of supported holidays.')
  })

  it('leaves no Tourist Drive vocabulary behind, in the markup or the styles', () => {
    const tourist = /odometer|tourist drive|route rail|stop signs?\b|concertina|overpass|strip map|sign--|km-plate|data-fold/i
    expect(indexHtml).not.toMatch(tourist)
    expect(css).not.toMatch(tourist)
  })
})

describe('proof: the real product, every figure tagged as sample data', () => {
  const figures = Array.from(doc.querySelectorAll('figure'))

  it('carries one "Sample data" tag per figure, and no tag outside a figure', () => {
    const tags = Array.from(doc.querySelectorAll('.tag'))
    expect(tags.length).toBe(figures.length)
    for (const tag of tags) expect(tag.textContent).toBe('Sample data')
    for (const fig of figures) expect(fig.querySelectorAll('.tag').length).toBe(1)
  })

  it('gives every image real alt text', () => {
    const imgs = Array.from(doc.querySelectorAll('img'))
    expect(imgs.length).toBe(15)
    for (const img of imgs) {
      expect(img.hasAttribute('alt')).toBe(true)
      expect(img.getAttribute('alt')!.length).toBeGreaterThan(30)
    }
  })

  it('shows all 15 proof screens, each a lazy WebP at 1x and 2x', () => {
    const names = Array.from(doc.querySelectorAll('img')).map((i) => fileOf(i.getAttribute('src')).replace('.webp', ''))
    expect(names).toEqual([
      'crew-roster-warning', 'plan-trip-glance', 'plan-dashboard-missing', 'stay-accommodation', 'crew-roster-board', 'crew-credentials',
      'care-shift-notes-phone', 'report-overdue', 'care-risk-alerts', 'care-shift-detail-phone', 'report-body-map-m',
      'fund-claim-funding-split-m', 'fund-claim-preview', 'fund-claim-batch', 'report-history',
    ])
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      expect(img.getAttribute('src')).toMatch(/\.webp$/)
      expect(img.getAttribute('srcset')).toMatch(/\.webp 1x, .*@2x\.webp 2x$/)
      expect(img.getAttribute('loading')).toBe('lazy')
    }
  })

  it('serves the art-directed narrow crops below 1024px as 1x/2x WebP sources', () => {
    const sources = Array.from(doc.querySelectorAll('picture source'))
    expect(sources.length).toBe(9)
    for (const s of sources) {
      expect(s.getAttribute('media')).toBe('(max-width: 1023px)')
      expect(s.getAttribute('srcset')).toMatch(/-m\.webp 1x, .*-m@2x\.webp 2x$/)
    }
  })

  it('gives every image and source the pixel size of the file it names, so nothing shifts while it loads', () => {
    const files = new Map(manifest.map((e) => [e.file1x, e]))
    const sized = [...Array.from(doc.querySelectorAll('img')), ...Array.from(doc.querySelectorAll('picture source'))]
    for (const el of sized) {
      const file = fileOf(el.getAttribute(el.tagName === 'IMG' ? 'src' : 'srcset'))
      const entry = files.get(file)
      expect(entry, `${file} is in the manifest`).toBeDefined()
      expect(Number(el.getAttribute('width')), `${file} width`).toBe(entry!.width1x)
      expect(Number(el.getAttribute('height')), `${file} height`).toBe(entry!.height1x)
    }
  })

  it('tells readers the people are fictional and some notes were written for the sample', () => {
    expect(visibleText).toContain('The people, trips and organisations in them are fictional, and some on-screen notes were written for the sample.')
  })
})

describe('the translation gate: three crossings, all in DOM text', () => {
  const crossings = Array.from(doc.querySelectorAll('[data-crossing]'))

  it('has one crossing per act, before, during and after, each followed by its proof band', () => {
    const acts = Array.from(doc.querySelectorAll('section.act')).map((s) => s.id)
    expect(acts).toEqual(['before', 'during', 'after'])
    expect(crossings.map((c) => c.closest('section')!.id)).toEqual(acts)
    for (const id of acts) {
      const section = doc.getElementById(id)!
      const order = Array.from(section.querySelectorAll('[data-crossing], .band'))
      expect(order.map((el) => (el.hasAttribute('data-crossing') ? 'crossing' : 'band'))).toEqual(['crossing', 'band'])
    }
  })

  it('puts the lived moment, the replay control and the record in the DOM, with the seam hidden from assistive tech', () => {
    for (const c of crossings) {
      expect(squash(c.querySelector('.crossing__text')!.textContent).length).toBeGreaterThan(30)
      const replay = c.querySelector('button[data-replay]')!
      expect(replay.getAttribute('type')).toBe('button')
      expect(squash(replay.textContent)).toMatch(/^Replay /)
      expect(c.querySelector('[data-gate]')!.getAttribute('aria-hidden')).toBe('true')
      expect(c.querySelector('.crossing__record figure img')).not.toBeNull()
      expect(c.getAttribute('data-arrived')!.length).toBeGreaterThan(20)
    }
  })

  it('announces arrivals through one polite live region', () => {
    const live = doc.querySelectorAll('[data-crossing-status]')
    expect(live.length).toBe(1)
    expect(live[0].getAttribute('aria-live')).toBe('polite')
  })

  it('keeps every block of text on the canopy in a quiet zone, and lights every paper clearing', () => {
    for (const sel of ['.hero__copy', '.act__text', '.crossing__moment', '.readings__inner', '.early__signin', '.site-footer__inner']) {
      for (const el of Array.from(doc.querySelectorAll(sel))) expect(el.hasAttribute('data-quiet'), sel).toBe(true)
    }
    for (const sel of ['.readout', '.crossing__record', '.band', '.clearing']) {
      for (const el of Array.from(doc.querySelectorAll(sel))) expect(el.hasAttribute('data-pool'), sel).toBe(true)
    }
  })
})

describe('structure, actions and accessibility', () => {
  it('has one h1, a skip link, and the offer and Sign in in the header', () => {
    expect(doc.querySelectorAll('h1').length).toBe(1)
    expect(doc.querySelector('a.skip')!.getAttribute('href')).toBe('#main')
    const header = doc.querySelector('.site-header')!
    expect(header.querySelector('a[href="/login"]')).not.toBeNull()
    const cta = header.querySelector('a[href="#early-access"]')!
    expect(cta.getAttribute('aria-label')).toBe('Request early access')
    expect(doc.querySelector('.hero a[href="#early-access"]')!.textContent).toContain('Request early access')
    expect(doc.querySelector('.hero a[href="#before"]')!.textContent).toBe('See it at work')
  })

  it('links Sign in to /login in the header, beside the form and in the footer', () => {
    const links = Array.from(doc.querySelectorAll('a[href="/login"]'))
    expect(links.length).toBe(3)
    for (const a of links) expect(squash(a.textContent)).toBe('Sign in')
  })

  it('indexes the sections in order, one nav, each link pointing at a section that exists', () => {
    const navs = doc.querySelectorAll('nav.sections')
    expect(navs.length).toBe(1)
    const links = Array.from(doc.querySelectorAll('[data-section-link]'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#before', '#during', '#after', '#early-access'])
    for (const a of links) expect(doc.getElementById(a.getAttribute('href')!.slice(1))).not.toBeNull()
    expect(links.map((a) => squash(a.querySelector('.sections__label')!.textContent))).toEqual([
      'Before the trip', 'During the trip', 'After the trip', 'Early access',
    ])
  })

  it('hides the canvas from assistive tech and ships the pause control hidden until the field runs', () => {
    expect(doc.querySelector('[data-canopy-light]')!.getAttribute('aria-hidden')).toBe('true')
    expect(doc.querySelector('[data-canopy-light] canvas')).not.toBeNull()
    const toggle = doc.querySelector('[data-light-toggle]')!
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.hasAttribute('hidden')).toBe(true)
    expect(squash(toggle.textContent)).toContain('Pause the Canopy light')
  })

  it('hides every icon from assistive tech', () => {
    const icons = Array.from(doc.querySelectorAll('svg.ico'))
    expect(icons.length).toBeGreaterThan(10)
    for (const svg of icons) {
      const hidden = svg.getAttribute('aria-hidden') === 'true' || svg.closest('[aria-hidden="true"]') !== null
      expect(hidden).toBe(true)
    }
  })

  it('labels every field, marks the honeypot as hidden, and shows the no-JavaScript note by default', () => {
    for (const id of ['ea-name', 'ea-organisation', 'ea-email']) {
      expect(doc.querySelector(`label[for="${id}"]`)).not.toBeNull()
      expect(doc.getElementById(id)!.hasAttribute('required')).toBe(true)
    }
    expect(doc.querySelector('.hp')!.getAttribute('aria-hidden')).toBe('true')
    expect(doc.getElementById('ea-website')!.getAttribute('tabindex')).toBe('-1')
    expect(doc.getElementById('early-access-form')!.hasAttribute('novalidate')).toBe(true)
    expect(doc.querySelector('form noscript')).toBeNull()
    const note = doc.querySelector('#early-access-form .form__nojs')!
    expect(note.textContent).toContain('needs JavaScript')
    expect(note.hasAttribute('hidden')).toBe(false)
    expect(doc.querySelector('[data-success] [data-success-email]')).not.toBeNull()
  })

  it('shows the neutral collection notice twice, and leaves the pre-release items as TODO(release) comments', () => {
    const notice = 'We will only use these details to reply about early access to Odip.'
    expect(visibleText.split(notice).length - 1).toBe(2)
    expect(indexHtml).toMatch(/<!-- TODO\(release\): say what early access is/)
    expect(indexHtml).toMatch(/<!-- TODO\(release\): collection notice\./)
    expect(indexHtml).toMatch(/<!-- TODO\(release\): name the collector/)
  })
})
