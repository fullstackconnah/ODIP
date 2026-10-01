import { describe, expect, it } from 'vitest'
import indexHtml from './index.html?raw'

// Guards for the landing page's contract: the CSP it must satisfy, the claims it must never make,
// and the numbers it may state. The claims come from the confirmed brief's safe list.
const doc = new DOMParser().parseFromString(indexHtml, 'text/html')
const visibleText = (() => {
  const clone = doc.body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, noscript, svg, .sr-only').forEach((n) => n.remove())
  return clone.textContent!.replace(/\s+/g, ' ').trim()
})()
const altText = Array.from(doc.querySelectorAll('img')).map((i) => i.getAttribute('alt') ?? '').join(' ')

describe('direction contract', () => {
  const comment = indexHtml.match(/^\s*<!--([\s\S]*?)-->/)

  it('opens the file, is 150 words or fewer, and carries the five blocks in order', () => {
    expect(comment).not.toBeNull()
    const body = comment![1].trim()
    expect(body.split(/\s+/).length).toBeLessThanOrEqual(150)
    const order = ['THESIS:', 'OWN-WORLD:', 'STORY:', 'FIRST VIEWPORT:', 'FORM:', 'FINISH:'].map((k) => body.indexOf(k))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('names the form, its position, the seed key and the staging, and closes with the FINISH line verbatim', () => {
    const body = comment![1]
    expect(body).toContain('candidate 3 of 7')
    expect(body).toContain('9680af9b')
    expect(body).toContain('folding volume')
    expect(body.trim().split('\n').pop()!.trim()).toBe(
      'FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md',
    )
  })
})

describe('CSP: what the page may load', () => {
  const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!
  const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '))

  it('allows same-origin scripts only, and the page has no inline script', () => {
    expect(directive('script-src')).toBe("script-src 'self'")
    const scripts = Array.from(doc.querySelectorAll('script'))
    expect(scripts.length).toBeGreaterThan(0)
    for (const s of scripts) {
      const src = s.getAttribute('src')
      expect(src, 'every script is an external file').toBeTruthy()
      expect(src).not.toMatch(/^(https?:)?\/\//)
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

  it('every image ships with the site (no remote src) and every stylesheet is Google Fonts or local', () => {
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      expect(img.getAttribute('src')).not.toMatch(/^(https?:)?\/\//)
      expect(img.getAttribute('srcset') ?? '').not.toMatch(/https?:\/\//)
    }
    for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
      expect(link.getAttribute('href')).toMatch(/^(\.\/|https:\/\/fonts\.googleapis\.com\/)/)
    }
  })
})

describe('claims: nothing outside the confirmed safe list', () => {
  const corpus = `${visibleText} ${altText}`
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
    ['customers, testimonials, pricing or ratings', /testimonial|customers? (say|love|trust)|per month|\/month|pricing|\$\d|rated|five stars?|trusted by/i],
  ])('does not claim %s', (_label, pattern) => {
    expect(corpus).not.toMatch(pattern)
  })

  it('never uses the exclamation-mark hype or scarcity language', () => {
    expect(visibleText).not.toMatch(/!|limited spots|limited places|hurry|don't miss|only \d+ (spots|places)/i)
  })

  it('states exactly the counted numbers on the route-marker plates', () => {
    const plates = Array.from(doc.querySelectorAll('.plate')).map((p) => ({
      n: p.querySelector('.plate__n')!.textContent!.trim(),
      label: p.querySelector('.plate__label')!.textContent!.trim(),
    }))
    expect(plates).toEqual([
      { n: '18', label: 'roster checks' },
      { n: '11', label: 'incident types' },
      { n: '5', label: 'credentials tracked' },
      { n: '3', label: 'funding types' },
      { n: '25', label: 'audited record types' },
    ])
  })

  it('carries the Oassist town-entry sentence verbatim', () => {
    const sign = doc.querySelector('.town__text')!.textContent!.replace(/\s+/g, ' ').trim()
    expect(sign).toBe('Oassist: a registered NDIS provider of supported holidays. Odip was built here.')
  })

  it('the fork sign names no products, only the category and Odip', () => {
    const fork = doc.querySelector('.sign--fork')!.textContent!.replace(/\s+/g, ' ')
    expect(fork).toContain('Roster-first software')
    expect(fork).toContain('Odip: built around the trip')
    expect(fork).not.toMatch(/\b(deputy|humanforce|shiftcare|brevity|splose|xero|astalty|nursebuddy)\b/i)
  })
})

describe('structure, actions and accessibility', () => {
  it('has one h1 and puts the offer, the action and Sign in in the first viewport', () => {
    expect(doc.querySelectorAll('h1').length).toBe(1)
    expect(doc.querySelector('h1')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Odip : Supported holidays, planned end to end')
    const header = doc.querySelector('.site-header')!
    expect(header.querySelector('a[href="/login"]')).not.toBeNull()
    expect(header.querySelector('a[href="#early-access"]')).not.toBeNull()
    expect(doc.querySelector('.hero a.exit[href="#early-access"]')!.textContent).toContain('Request early access')
  })

  it('links Sign in to /login in the header, at the destination and in the footer', () => {
    const links = Array.from(doc.querySelectorAll('a[href="/login"]'))
    expect(links.length).toBe(3)
    for (const a of links) expect(a.textContent!.trim()).toBe('Sign in')
  })

  it('every stop link and stage sign points at a fold that exists, in order', () => {
    const ids = Array.from(doc.querySelectorAll('[data-fold]')).map((f) => f.id)
    expect(ids).toEqual(['stage-plan', 'stage-stay', 'stage-crew', 'stage-care', 'stage-fund', 'stage-compliant'])
    for (const sel of ['[data-stop]', '.stage-signs a']) {
      expect(Array.from(doc.querySelectorAll(sel)).map((a) => a.getAttribute('href')!.slice(1))).toEqual(ids)
    }
    expect(Array.from(doc.querySelectorAll('.fold .sign__label')).map((h) => h.textContent)).toEqual([
      'Plan', 'Stay', 'Crew', 'Care', 'Fund and claim', 'Stay compliant',
    ])
  })

  it('counts the distance markers down to Early access 0 km', () => {
    expect(Array.from(doc.querySelectorAll('.fold .sign__km')).map((k) => k.textContent)).toEqual(['60 km', '50 km', '40 km', '30 km', '20 km', '10 km'])
    expect(doc.querySelector('.km-plate')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Early access 0 km')
  })

  it('every real screen is a lazy WebP at 1x and 2x with real alt text, dimensions and a "Sample data" label', () => {
    const figures = Array.from(doc.querySelectorAll('.fold figure.screen'))
    expect(figures.length).toBeGreaterThanOrEqual(6)
    for (const fig of figures) {
      const img = fig.querySelector('img')!
      expect(img.getAttribute('src')).toMatch(/\.webp$/)
      expect(img.getAttribute('srcset')).toMatch(/\.webp 1x, .*@2x\.webp 2x$/)
      expect(img.getAttribute('loading')).toBe('lazy')
      expect(img.getAttribute('alt')!.length).toBeGreaterThan(30)
      expect(img.getAttribute('alt')).not.toContain('@ALT')
      expect(Number(img.getAttribute('width'))).toBeGreaterThan(0)
      expect(Number(img.getAttribute('height'))).toBeGreaterThan(0)
      expect(fig.querySelector('figcaption .tag')!.textContent).toBe('Sample data')
    }
  })

  it('hides every pictograph from assistive tech', () => {
    const pics = Array.from(doc.querySelectorAll('svg.pic'))
    expect(pics.length).toBeGreaterThan(20)
    for (const svg of pics) {
      const hidden = svg.getAttribute('aria-hidden') === 'true' || svg.closest('[aria-hidden="true"]') !== null
      expect(hidden).toBe(true)
    }
  })

  it('the form labels every field and marks the honeypot as hidden', () => {
    for (const id of ['ea-name', 'ea-organisation', 'ea-email']) {
      expect(doc.querySelector(`label[for="${id}"]`)).not.toBeNull()
      expect(doc.getElementById(id)!.hasAttribute('required')).toBe(true)
    }
    expect(doc.querySelector('.hp')!.getAttribute('aria-hidden')).toBe('true')
    expect(doc.getElementById('ea-website')!.getAttribute('tabindex')).toBe('-1')
    expect(doc.getElementById('early-access-form')!.hasAttribute('novalidate')).toBe(true)
  })

  it('shows the neutral collection notice, and leaves the pre-release items as TODO comments', () => {
    const notice = 'We will only use these details to reply about early access to Odip.'
    expect(visibleText.split(notice).length - 1).toBe(2)
    expect(indexHtml).toMatch(/<!-- TODO\(release\): collection notice\./)
    expect(indexHtml).toMatch(/<!-- TODO\(release\): name the collector/)
  })
})

describe('finish-review corrections', () => {
  it('names the header call to action at every width (the short label is not hidden from assistive tech)', () => {
    const cta = doc.querySelector('.site-header a[href="#early-access"]')!
    expect(cta.getAttribute('aria-label')).toBe('Request early access')
    expect(cta.querySelector('.cta-short')!.hasAttribute('aria-hidden')).toBe(false)
  })
})
