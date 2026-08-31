// MED-01: constants and pure helpers for the missed-medication guidance shown when a MAR outcome
// is Refused/Withheld/Missed/WrongMedication (never for Administered). Copy and phone numbers are
// sourced from the MED-01/ROSTER-01 research spike (2026-08-31) — do not add dosing advice of any
// kind here or in the component that renders this data. Every escalation routes through a
// qualified line (manager -> health advice line -> Poisons Information Centre -> pharmacy -> 000),
// never a search engine or app-implied clinical judgement.

import type { PackagingType } from '@/api/types/enums'

export const POISONS_INFO_PHONE = '13 11 26'
export const EMERGENCY_PHONE = '000'

export interface HealthAdviceLine {
  label: string
  phone: string
}

/**
 * Health/nurse advice line shown in step 2 of the guidance, keyed off
 * ProviderSettings.State (Odip.Domain/Entities/ProviderSettings.cs, defaults "VIC").
 *
 * VIC -> Nurse-on-Call, 1300 60 60 24 (24/7, free, registered-nurse advice). The backlog's
 * "13 60 24" was wrong — verified against healthdirect/Better Health Channel during the MED-01
 * research spike (2026-08-31). The national healthdirect line (1800 022 222) is always shown too,
 * as a fallback.
 *
 * Non-VIC / unset -> only the national healthdirect line, 1800 022 222 — no state-specific number
 * was verified for other states/territories during the research, so it isn't special-cased and
 * "Nurse-on-Call" (a VIC brand name) isn't used for other tenants.
 *
 * Keep this mapping here, in one place — every caller (the guidance component, and its tests)
 * should go through this function rather than re-deriving the numbers.
 */
export function healthAdviceLine(state: string | null | undefined): { primary: HealthAdviceLine; fallback?: HealthAdviceLine } {
  const isVic = (state ?? '').trim().toUpperCase() === 'VIC'
  const national: HealthAdviceLine = { label: 'National health advice line', phone: '1800 022 222' }
  if (isVic) {
    return { primary: { label: 'Nurse-on-Call (VIC)', phone: '1300 60 60 24' }, fallback: national }
  }
  return { primary: national }
}

/** tel: href for a phone number rendered with spaces (tel: hrefs must not contain them). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/\s+/g, '')}`
}

/** Packaging-specific phrasing for the "check the label" guidance step. */
export const PACKAGING_CHECK_LABEL: Record<PackagingType, string> = {
  WebsterPack: 'Check the Webster pack label',
  DosetteBox: 'Check the dosette box label',
  OriginalPackaging: 'Check the original packaging',
  Sachet: 'Check the sachet label',
  Other: 'Check the medication packaging',
}
