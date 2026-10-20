import { describe, expect, it } from 'vitest'
import indexHtml from './index.html?raw'
import { initPlatformFacts } from './platform'
import type { PlatformInfo } from '../src/lib/platformInfo'

const NONE: PlatformInfo = { companyName: null, abn: null, supportEmail: null, statusUrl: null, legalPublished: false, version: undefined, buildSha: undefined }
const FULL: PlatformInfo = {
  companyName: 'Example Pty Ltd', abn: '12345678901', supportEmail: 'help@example.org', statusUrl: 'https://status.example.org',
  legalPublished: true, version: '1.0.0', buildSha: '7be2ef82a1c3',
}
const PRODUCT = ['Approvals', 'Rostering', 'Enquiries and intake', 'Agreements and budgets', 'Incidents and compliance work', 'Claims file', 'My shifts']
const NOTICE = "How we handle these details Bunya Support collects the details in this form to contact you about the alpha and set you up. They're stored in the Bunya Support platform, seen only by our team, and used for nothing else. We keep them until the alpha ends, for 12 months at most, or delete them sooner if you ask. To see, change or remove your details, send the form again and say so in the message."

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
const column = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('.f-col')).find((c) => text(c.querySelector('h2')) === name)!

describe('initPlatformFacts', () => {
  it('leaves every bound element hidden while nothing is set: Company and Support hide whole, Legal holds its three own links', () => {
    mount(NONE)
    expect(shown('[data-platform]')).toEqual([])
    expect(column('Company').hidden).toBe(true)
    expect(column('Support').hidden).toBe(true)
    expect(shown('.f-col a').map(text)).toEqual([...PRODUCT, 'Accessibility', 'What alpha means', 'Join the alpha'])
  })

  it('fills and shows every value once it is set', () => {
    mount(FULL)
    expect(column('Company').hidden).toBe(false)
    expect(column('Support').hidden).toBe(false)
    expect(shown('[data-platform="companyName"]').map(text)).toEqual(['Example Pty Ltd'])
    expect(shown('[data-platform="abn"]').map(text)).toEqual(['ABN 12 345 678 901'])
    expect(document.querySelector('[data-platform="supportEmail"] a')!.getAttribute('href')).toBe('mailto:help@example.org')
    expect(shown('.f-col a').map(text)).toEqual([
      ...PRODUCT, 'Privacy Policy', 'Terms of Service', 'Accessibility', 'What alpha means', 'Join the alpha', 'help@example.org',
    ])
    expect(text(document.querySelector('#form-notice'))).toBe(
      NOTICE.replace('Bunya Support collects', 'Bunya Support (Example Pty Ltd) collects') + ' Our Privacy Policy has the detail.',
    )
  })

  it('hides a malformed value exactly like a missing one, and hides the column it empties', () => {
    mount({ ...FULL, abn: '1234', supportEmail: 'help.example.org', statusUrl: 'http://status.example.org', legalPublished: false })
    expect(shown('[data-platform="abn"]')).toEqual([])
    expect(shown('[data-platform="companyName"]').map(text)).toEqual(['Example Pty Ltd'])
    expect(column('Support').hidden).toBe(true)
    expect(shown('[data-platform="privacy"], [data-platform="terms"], [data-platform="privacyNotice"]')).toEqual([])
  })

  it('shows no name, ABN or collector without a company name', () => {
    mount({ ...FULL, companyName: '  ' })
    expect(shown('[data-platform="companyName"], [data-platform="abn"], [data-platform="collector"]')).toEqual([])
    expect(column('Company').hidden).toBe(true)
  })
})
