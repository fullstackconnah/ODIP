import { describe, expect, it } from 'vitest'
import indexHtml from './index.html?raw'
import { initPlatformFacts } from './platform'
import type { PlatformInfo } from '../src/lib/platformInfo'

const NONE: PlatformInfo = { companyName: null, abn: null, supportEmail: null, statusUrl: null, legalPublished: false, version: undefined, buildSha: undefined }
const FULL: PlatformInfo = {
  companyName: 'Odip Pty Ltd', abn: '12345678901', supportEmail: 'help@example.org', statusUrl: 'https://status.example.org',
  legalPublished: true, version: '1.0.0', buildSha: '7be2ef82a1c3',
}

/** The real markup from welcome/index.html (the form's notice and the footer), so the markup and the module cannot drift apart. */
function mount(info: PlatformInfo) {
  const page = new DOMParser().parseFromString(indexHtml, 'text/html')
  document.body.replaceChildren(
    document.importNode(page.querySelector('#form-notice')!, true),
    document.importNode(page.querySelector('.site-footer')!, true),
  )
  initPlatformFacts(document, info, new Date(2026, 9, 14))
}
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const shown = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.closest('[hidden]'))
const column = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('.site-footer__col')).find((c) => text(c.querySelector('h2')) === name)!

describe('initPlatformFacts', () => {
  it('leaves every bound element hidden while nothing is set: Company and Support hide whole, Legal holds only Accessibility', () => {
    mount(NONE)
    expect(shown('[data-platform]')).toEqual([])
    expect(column('Company').hidden).toBe(true)
    expect(column('Support').hidden).toBe(true)
    expect(shown('.site-footer__col a').map(text)).toEqual(['Before the trip', 'During the trip', 'After the trip', 'Request early access', 'Accessibility'])
  })

  it('fills and shows every value once it is set', () => {
    mount(FULL)
    expect(column('Company').hidden).toBe(false)
    expect(column('Support').hidden).toBe(false)
    expect(shown('[data-platform="companyName"]').map(text)).toEqual(['Odip Pty Ltd'])
    expect(shown('[data-platform="abn"]').map(text)).toEqual(['ABN 12 345 678 901'])
    expect(shown('[data-platform="copyright"]').map(text)).toEqual(['© 2026 Odip Pty Ltd'])
    expect(document.querySelector('[data-platform="supportEmail"] a')!.getAttribute('href')).toBe('mailto:help@example.org')
    expect(document.querySelector('[data-platform="statusUrl"] a')!.getAttribute('href')).toBe('https://status.example.org')
    expect(shown('.site-footer__col a').map(text)).toEqual([
      'Before the trip', 'During the trip', 'After the trip', 'Request early access',
      'Privacy Policy', 'Terms of Service', 'Accessibility', 'help@example.org', 'Status (opens in a new tab)',
    ])
    const sentence = 'We will only use these details to reply about early access to Odip. Odip Pty Ltd is collecting these details. Read our Privacy Policy, which explains how we handle them and how to contact us.'
    expect(text(document.querySelector('#form-notice'))).toBe(sentence)
    expect(text(document.querySelector('.site-footer__notes p'))).toBe(sentence)
  })

  it('hides a malformed value exactly like a missing one, and hides the column it empties', () => {
    mount({ ...FULL, abn: '1234', supportEmail: 'help.example.org', statusUrl: 'http://status.example.org', legalPublished: false })
    expect(shown('[data-platform="abn"]')).toEqual([])
    expect(shown('[data-platform="companyName"]').map(text)).toEqual(['Odip Pty Ltd'])
    expect(column('Support').hidden).toBe(true)
    expect(shown('[data-platform="privacy"], [data-platform="terms"], [data-platform="privacyNotice"]')).toEqual([])
  })

  it('shows no name, ABN, copyright or collector without a company name', () => {
    mount({ ...FULL, companyName: '  ' })
    expect(shown('[data-platform="companyName"], [data-platform="abn"], [data-platform="copyright"], [data-platform="collector"]')).toEqual([])
    expect(column('Company').hidden).toBe(true)
  })
})
