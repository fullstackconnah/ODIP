import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import indexHtml from './index.html?raw'
import appIndexHtml from '../index.html?raw'
import { ACKNOWLEDGEMENT_OF_COUNTRY } from '../src/lib/platformFacts'

// CSS is read from disk: the test run does not process CSS (vite.config.ts `css: false`).
const css = readFileSync(join(__dirname, 'welcome.css'), 'utf-8')

// Guards for the landing page's contract: the CSP it must satisfy, the copy and claims it must keep (SHAPE section 3,
// spec L4), the form's markup, the footer's bound facts, and the proof it must show.
const doc = new DOMParser().parseFromString(indexHtml, 'text/html')
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const visibleText = (() => {
  const clone = doc.body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, svg, .sr-only').forEach((n) => n.remove())
  return squash(clone.textContent)
})()
const altText = Array.from(doc.querySelectorAll('img')).map((i) => i.getAttribute('alt') ?? '').join(' ')
const attrText = Array.from(doc.querySelectorAll('[aria-label], [title]'))
  .map((el) => [el.getAttribute('aria-label'), el.getAttribute('title')].join(' '))
  .join(' ')
const words = `${visibleText} ${altText} ${attrText} ${doc.title} ${doc.querySelector('meta[name="description"]')?.getAttribute('content')}`
const SLOTS = ['t0830', 't1000', 't1130', 't1300', 't1430', 't1600', 'onshift']
const text = (sel: string) => squash(doc.querySelector(sel)!.textContent)
const attrs = (sel: string, name: string) => Array.from(doc.querySelectorAll(sel)).map((el) => el.getAttribute(name))

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

  it('every image ships with the site, the icons are the app\'s own, and every stylesheet is Google Fonts or local', () => {
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      expect(img.getAttribute('src')).not.toMatch(/^(https?:)?\/\//)
      expect(img.getAttribute('srcset') ?? '').not.toMatch(/https?:\/\//)
    }
    for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
      expect(link.getAttribute('href')).toMatch(/^(\.\/|https:\/\/fonts\.googleapis\.com\/)/)
    }
    expect([attrs('link[rel="icon"]', 'href'), attrs('link[rel="apple-touch-icon"]', 'href')]).toEqual([['/favicon.svg'], ['/apple-touch-icon.png']])
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


describe('claims (spec L4)', () => {
  it('makes no outcome claim, even in a file name; "compliance work" and one Employment Hero line are allowed', () => {
    expect(indexHtml).not.toMatch(/\bcompliant\b|certif|guarantee/i)
    expect(visibleText).toContain('Built for NDIS compliance work')
    expect(visibleText.split('Employment Hero').length - 1).toBe(1)
    expect(visibleText).toContain('Syncs staff from Employment Hero, if you use it.')
  })
  it.each([
    /xero|brevity|splose|shiftcare|linxio|budgetly|payroll|family portal|complaints? (register|management)/i,
    /(connects?|integrat\w*|submits?|syncs?|lodges?) (with |to )?(proda|the ndis commission|ndia)|report\w* to the (ndis )?commission/i,
    /5[- ]day|five[- ]day|count-?down|live timer|offline|\bpwa\b|installable|install the app|e-?sign|reconcil|\bsms\b|text message/i,
    /testimonial|customers? (say|love|trust)|per month|\/month|pricing|\$\d|\brated\b|five stars?|trusted by|\bfree\b|every change|\brooms?\b/i,
    /\bAI\b|AI-powered/,
  ])('claims nothing matching %s', (pattern) => expect(words).not.toMatch(pattern))
  it('has no exclamation marks, scarcity or brief vocabulary', () => {
    expect(visibleText).not.toMatch(/!|limited (spots|places)|hurry|don't miss|only \d+ (spots|places)/i)
    expect(indexHtml).not.toMatch(/THESIS|OWN-WORLD|FIRST VIEWPORT|seed ee897db1/)
  })
})
describe('first viewport and the day plan (SHAPE section 3)', () => {
  it('says what it is, for whom, and the offer; no OG or canonical yet (L8)', () => {
    expect(doc.title).toBe('Bunya Support: NDIS and disability service provider software')
    expect(attrs('meta[name="description"]', 'content')).toEqual(['Next-generation NDIS and disability service provider software: approvals, rosters, intake, agreements, incidents and the claims file in one place, so your admin team gets time back. Now in alpha.'])
    expect(text('h1')).toBe('From the first approval to the claims file, in one place.')
    expect(text('.hero .lede')).toBe('Bunya Support is the next generation of NDIS and disability service provider software. Rosters and shifts, intake, agreements, incidents and the claims file sit in one place, so less of the day goes on admin and your admin team gets time back.')
    expect(doc.querySelector('meta[property^="og:"], link[rel="canonical"]')).toBeNull()
  })
  it('indexes the 7 slots in order; each has Before and With Bunya Support; the rail is hidden', () => {
    expect(attrs('nav[aria-label="An admin day with Bunya Support"] a', 'href')).toEqual(SLOTS.map((s) => '#' + s))
    for (const id of SLOTS) expect(Array.from(doc.querySelectorAll(`#${id} h3`)).map((h) => squash(h.textContent))).toEqual(['Before', 'With Bunya Support'])
    expect([attrs('.rail [data-for]', 'data-for'), attrs('.rail', 'aria-hidden')]).toEqual([SLOTS, ['true']])
  })
  it('marks the alpha in the bar and the hero, and says what happens next', () => {
    expect(doc.querySelectorAll('.site-header .alpha-tag, .hero .alpha-tag').length).toBe(2)
    expect(visibleText).toContain('Now in alpha')
    expect([text('#alpha h2'), text('#join').includes('No confirmation email is sent')]).toEqual(['What alpha means.', true])
  })
})
describe('structure, the form and the CSS guards', () => {
  it('has one h1, the skip link, Sign in in the bar, the join copy and the footer, and every svg hidden', () => {
    expect([doc.querySelectorAll('h1').length, attrs('a.skip', 'href')]).toEqual([1, ['#main']])
    expect(Array.from(doc.querySelectorAll('a[href="/login"]')).map((a) => [squash(a.textContent), a.closest('.site-header, .join, .site-footer')!.classList[0]]))
      .toEqual([['Sign in', 'site-header'], ['Sign in', 'join'], ['Sign in', 'site-footer']])
    for (const svg of Array.from(doc.querySelectorAll('svg'))) expect(svg.closest('[aria-hidden="true"]')).not.toBeNull()
  })
  it.each([
    ['f-name', 'name', true, '100', 'name', 'f-name-error'],
    ['f-org', 'organisation', true, '150', 'organization', 'f-org-error'],
    ['f-role', 'role', false, '100', 'organization-title', 'f-role-hint f-role-error'],
    ['f-size', 'organisationSize', true, null, null, 'f-size-error'],
    ['f-email', 'email', true, '254', 'email', 'f-email-error'],
    ['f-phone', 'phone', false, '30', 'tel', 'f-phone-hint f-phone-error'],
    ['f-message', 'message', false, '1000', null, 'f-message-hint f-message-error'],
  ])('labels %s with its name, limit, autocomplete and description', (id, name, required, max, auto, described) => {
    const el = doc.getElementById(id)!
    expect([!!doc.querySelector(`label[for="${id}"]`), el.getAttribute('name'), el.getAttribute('data-field'), el.hasAttribute('required'), el.getAttribute('maxlength'), el.getAttribute('autocomplete'), el.getAttribute('aria-describedby')])
      .toEqual([true, name, name, required, max, auto, described])
    for (const ref of described.split(' ')) expect(doc.getElementById(ref), ref).not.toBeNull()
    expect(attrs(`#${id}-error`, 'data-error')).toEqual([name])
  })
  it('offers the 4 size codes behind an empty placeholder', () => {
    expect(attrs('#f-size option', 'value')).toEqual(['', 'under-10', '10-49', '50-199', '200-plus'])
    expect(Array.from(doc.querySelectorAll('#f-size option')).map((o) => squash(o.textContent))).toEqual(['Choose a size', 'Fewer than 10 staff', '10 to 49 staff', '50 to 199 staff', '200 staff or more'])
  })
  it('ships the no-JS guard, the honeypot, and the status and received panel hidden', () => {
    const has = (sel: string, a: string) => doc.querySelector(sel)!.hasAttribute(a)
    expect([attrs('#alpha-form', 'aria-describedby')[0], has('#alpha-form', 'novalidate')]).toEqual(['form-notice', true])
    expect([text('[data-nojs]'), has('[data-nojs]', 'hidden'), has('[data-submit]', 'disabled')]).toEqual(['This form needs JavaScript. Turn it on and reload to join the alpha.', false, true])
    expect([attrs('.hp', 'aria-hidden')[0], attrs('#f-website', 'tabindex')[0], attrs('#f-website', 'data-field')[0]]).toEqual(['true', '-1', 'website'])
    expect([attrs('[data-status]', 'role')[0], has('[data-status]', 'hidden'), has('[data-form-panel] [data-success]', 'hidden')]).toEqual(['alert', true, true])
    expect([text('[data-success-heading]'), text('[data-reset]')]).toEqual(['Thanks, we have your details.', 'Send another sign-up'])
  })
  it('lets the hidden attribute beat every display rule, so the received panel (display: grid) is hidden on load', () => {
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/)
  })
  it('stays inside its weight: index.html 45 KB and welcome.css 26 KB (1 KB = 1,024 bytes, SHAPE section 10 #14)', () => {
    expect(new TextEncoder().encode(indexHtml).length).toBeLessThanOrEqual(45 * 1024)
    expect(new TextEncoder().encode(css).length).toBeLessThanOrEqual(26 * 1024)
  })
})
const NOTICE = "How we handle these details Bunya Support collects the details in this form to contact you about the alpha and set you up. They're stored in the Bunya Support platform, seen only by our team, and used for nothing else. We keep them until the alpha ends, for 12 months at most, or delete them sooner if you ask. To see, change or remove your details, send the form again and say so in the message."
describe('the collection notice (L6) and the footer (SHAPE section 7)', () => {
  it('shows the notice once, in the owner words, its bound parts hidden, and no email anywhere', () => {
    const clone = doc.getElementById('form-notice')!.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[hidden]').forEach((n) => n.remove())
    expect(squash(clone.textContent)).toBe(NOTICE)
    expect(visibleText.split('How we handle these details').length - 1).toBe(1)
    expect(indexHtml).not.toMatch(/mailto:/)
  })
  it('opens with the Acknowledgement, heads four columns, links the 7 slots and always Accessibility', () => {
    expect(doc.querySelector('.site-footer .wrap')!.firstElementChild!.classList.contains('ack')).toBe(true)
    expect(text('.site-footer .ack p')).toBe(ACKNOWLEDGEMENT_OF_COUNTRY)
    expect(Array.from(doc.querySelectorAll('.f-col > h2')).map((h) => squash(h.textContent))).toEqual(['Product', 'Company', 'Legal', 'Support'])
    expect(Array.from(doc.querySelectorAll('.f-col')[0].querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(SLOTS.map((s) => '#' + s))
    expect(doc.querySelector('.site-footer a[href="/accessibility"]')!.closest('[hidden]')).toBeNull()
    expect(text('.f-notes')).toBe('Sample data The screens on this page show sample data, with fictional people and organisations.')
  })
  it('ships every bound element hidden and every bound fact empty', () => {
    expect(attrs('[data-platform]', 'data-platform').sort()).toEqual(['abn', 'collector', 'companyName', 'privacy', 'privacyNotice', 'supportEmail', 'terms'])
    for (const el of Array.from(doc.querySelectorAll('[data-platform], [data-platform-group]'))) expect(el.hasAttribute('hidden')).toBe(true)
    for (const key of ['companyName', 'abn', 'collector']) expect(text(`[data-platform="${key}"]`)).toBe('')
  })
  it('tags each of the 11 figures once as Sample data (placeholders until Task 6)', () => {
    expect(Array.from(doc.querySelectorAll('main figure')).map((f) => Array.from(f.querySelectorAll('.tag')).map((t) => t.textContent))).toEqual(Array(11).fill(['Sample data']))
    expect(doc.querySelectorAll('.tag').length).toBe(11)
  })
})

describe('the app page (frontend/index.html)', () => {
  it('declares Australian English, like the landing', () => {
    expect(appIndexHtml).toMatch(/<html lang="en-AU">/)
    expect(doc.documentElement.getAttribute('lang')).toBe('en-AU')
  })
})

