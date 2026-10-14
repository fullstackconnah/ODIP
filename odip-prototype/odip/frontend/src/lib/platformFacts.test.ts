import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { ACKNOWLEDGEMENT_OF_COUNTRY, platformFacts } from './platformFacts'
import { PLATFORM_INFO, type PlatformInfo } from './platformInfo'

const NONE: PlatformInfo = { companyName: null, abn: null, supportEmail: null, statusUrl: null, legalPublished: false, version: undefined, buildSha: undefined }
const FULL: PlatformInfo = {
  companyName: 'Odip Pty Ltd', abn: '12345678901', supportEmail: 'help@example.org', statusUrl: 'https://status.example.org',
  legalPublished: true, version: '1.0.0', buildSha: '7be2ef82a1c3',
}
const TODAY = new Date(2026, 9, 14)

describe('platformFacts: every row of SHAPE 6.1', () => {
  it('hides every value when nothing is set', () => {
    expect(platformFacts(NONE, TODAY)).toEqual({ company: null, copyright: null, abn: null, supportEmail: null, statusUrl: null, legal: false, build: null })
  })

  it('checks and formats every value when all are set', () => {
    expect(platformFacts(FULL, TODAY)).toEqual({
      company: 'Odip Pty Ltd', copyright: '© 2026 Odip Pty Ltd', abn: '12 345 678 901', supportEmail: 'help@example.org',
      statusUrl: 'https://status.example.org', legal: true, build: 'v1.0.0 · 7be2ef8',
    })
  })

  it.each<[string, string | null]>([['', null], ['   ', null], ['  Odip Pty Ltd ', 'Odip Pty Ltd']])('company name %j shows %j', (companyName, company) => {
    expect(platformFacts({ ...FULL, companyName }, TODAY).company).toBe(company)
  })

  it('hides the copyright and the ABN when there is no company name: an ABN beside no name says nothing', () => {
    const facts = platformFacts({ ...FULL, companyName: null }, TODAY)
    expect(facts.copyright).toBeNull()
    expect(facts.abn).toBeNull()
  })

  it.each<[string, string | null]>([
    ['12 345 678 901', '12 345 678 901'],
    ['12345678901', '12 345 678 901'],
    ['1234', null],
    ['123456789012', null],
    ['12 345 678 90A', null],
    ['', null],
  ])('ABN %j shows %j', (abn, shown) => {
    expect(platformFacts({ ...FULL, abn }, TODAY).abn).toBe(shown)
  })

  it.each<[string, string | null]>([
    ['help@example.org', 'help@example.org'],
    ['help.example.org', null],
    ['help @example.org', null],
    ['@example.org', null],
    ['help@', null],
    ['a@b@c.org', null],
  ])('support email %j shows %j', (supportEmail, shown) => {
    expect(platformFacts({ ...FULL, supportEmail }, TODAY).supportEmail).toBe(shown)
  })

  it.each<[string, string | null]>([
    ['https://status.example.org', 'https://status.example.org'],
    ['http://status.example.org', null],
    ['javascript:alert(1)', null],
    ['status.example.org', null],
    ['', null],
  ])('status URL %j shows %j', (statusUrl, shown) => {
    expect(platformFacts({ ...FULL, statusUrl }, TODAY).statusUrl).toBe(shown)
  })

  it('shows Privacy and Terms only while legalPublished is true', () => {
    expect(platformFacts({ ...FULL, legalPublished: true }, TODAY).legal).toBe(true)
    expect(platformFacts({ ...FULL, legalPublished: false }, TODAY).legal).toBe(false)
  })

  it.each<[string | undefined, string | undefined, string | null]>([
    ['1.0.0', '7be2ef82a1c3', 'v1.0.0 · 7be2ef8'],
    [undefined, '7be2ef82a1c3', 'Build 7be2ef8'],
    ['0.0.0', '7be2ef82a1c3', 'Build 7be2ef8'],
    ['1.0.0', undefined, 'v1.0.0'],
    ['1.0.0', 'dev', 'v1.0.0'],
    ['1.0.0', '', 'v1.0.0'],
    ['0.0.0', 'dev', null],
    [undefined, undefined, null],
  ])('version %j with sha %j shows %j', (version, buildSha, build) => {
    expect(platformFacts({ ...FULL, version, buildSha }, TODAY).build).toBe(build)
  })

  it('takes the year from the clock it is given', () => {
    expect(platformFacts(FULL, new Date(2031, 0, 1)).copyright).toBe('© 2031 Odip Pty Ltd')
  })
})

describe('PLATFORM_INFO as committed', () => {
  it('reads the version from package.json through the vite define', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string }
    expect(PLATFORM_INFO.version).toBe(pkg.version)
  })

  it('holds no placeholder: every fact is real or null', () => {
    for (const [key, value] of Object.entries(PLATFORM_INFO)) {
      if (typeof value === 'string') expect(value, key).not.toMatch(/\[|\]|example|todo|tbd|placeholder|xxx|12 ?345 ?678 ?901/i)
    }
  })

  it('words the acknowledgement as SHAPE 6.2 does', () => {
    expect(ACKNOWLEDGEMENT_OF_COUNTRY).toBe(
      'We acknowledge the Aboriginal and Torres Strait Islander Traditional Custodians of Country throughout Australia, and recognise their continuing connection to land, sea, culture and community. We pay our respects to Elders past and present.',
    )
  })
})
