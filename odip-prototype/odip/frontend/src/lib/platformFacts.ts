import type { PlatformInfo } from './platformInfo'

/** Word for word on every surface (SHAPE 6.2): "We", so it reads the same before and after the company is registered. */
export const ACKNOWLEDGEMENT_OF_COUNTRY =
  'We acknowledge the Aboriginal and Torres Strait Islander Traditional Custodians of Country throughout Australia, and recognise their continuing connection to land, sea, culture and community. We pay our respects to Elders past and present.'

export type PlatformFacts = {
  company: string | null
  /** `© 2026 {company}`. */
  copyright: string | null
  /** `12 345 678 901`; null without a company, since an ABN beside no name tells the reader nothing. */
  abn: string | null
  supportEmail: string | null
  statusUrl: string | null
  /** Privacy and Terms may show. */
  legal: boolean
  /** `v1.0.0 · 7be2ef8`, `Build 7be2ef8`, `v1.0.0`, or null. */
  build: string | null
}

/** The trust boundary for the footer's facts: a value that fails its check comes back null, exactly like a missing one. */
export function platformFacts(info: PlatformInfo, today: Date = new Date()): PlatformFacts {
  const company = info.companyName?.trim() || null
  const abnDigits = info.abn?.replace(/ /g, '') ?? ''
  const version = info.version && info.version !== '0.0.0' ? `v${info.version}` : null
  const sha = info.buildSha && /^[0-9a-f]{7,40}$/i.test(info.buildSha) ? info.buildSha.slice(0, 7) : null
  return {
    company,
    copyright: company && `© ${today.getFullYear()} ${company}`,
    abn: company && /^\d{11}$/.test(abnDigits)
      ? `${abnDigits.slice(0, 2)} ${abnDigits.slice(2, 5)} ${abnDigits.slice(5, 8)} ${abnDigits.slice(8)}`
      : null,
    supportEmail: info.supportEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.supportEmail) ? info.supportEmail : null,
    statusUrl: isHttpsUrl(info.statusUrl) ? info.statusUrl : null,
    legal: info.legalPublished === true,
    build: version && sha ? `${version} · ${sha}` : version ?? (sha && `Build ${sha}`),
  }
}

function isHttpsUrl(url: string | null): url is string {
  try {
    return url !== null && new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
