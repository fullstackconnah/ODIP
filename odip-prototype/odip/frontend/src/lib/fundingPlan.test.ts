import { describe, expect, it } from 'vitest'
import type { FundingPlanDto } from '@/api/types'
import { categoriesLabel, confirmedLabel, currentPlanOf, managementLabel, paceNumber, planStatus, planTitle, planTotal, writtenDay, writtenSpan } from './fundingPlan'

/** A written date as an ordinary string: its non-breaking spaces (kept so a date does not split across lines) read as the spaces they look like. */
const plain = (text: string): string => text.split(String.fromCharCode(160)).join(' ')

const plan = (id: string, planStart: string, planEnd: string, extra: Partial<FundingPlanDto> = {}): FundingPlanDto => ({
  id, participantId: 'p1', planStart, planEnd, evidence: 'PlanCopy', revision: 1, createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z', pools: [], ...extra,
})

describe('which plan is current', () => {
  const last = plan('last', '2025-07-01', '2026-06-30')
  const running = plan('running', '2026-07-01', '2027-06-30')
  const next = plan('next', '2027-07-01', '2028-06-30')
  const later = plan('later', '2028-07-01', '2029-06-30')

  it('is the plan running today, whichever way round the list is', () => {
    expect(currentPlanOf([next, running, last], '2026-10-04')?.id).toBe('running')
    expect(currentPlanOf([running], '2026-07-01')?.id).toBe('running')   // its first day
    expect(currentPlanOf([running], '2027-06-30')?.id).toBe('running')   // its last day
  })

  it('is the next plan to start when none is running yet, and the newest when every plan has ended', () => {
    expect(currentPlanOf([later, next], '2027-01-01')?.id).toBe('next')
    expect(currentPlanOf([running, last], '2030-01-01')?.id).toBe('running')
  })

  it('is nothing when there are no plans', () => {
    expect(currentPlanOf([], '2026-10-04')).toBeUndefined()
  })

  it('reads a plan as current, upcoming or ended', () => {
    expect(planStatus(running, '2026-10-04')).toBe('Current')
    expect(planStatus(next, '2026-10-04')).toBe('Upcoming')
    expect(planStatus(last, '2026-10-04')).toBe('Ended')
    expect(planStatus(last, '2026-06-30')).toBe('Current')
    expect(planStatus(last, '2026-07-01')).toBe('Ended')
  })
})

describe('how a plan reads', () => {
  it('prints a support category as its two-digit number, and a Core pool as 01–04', () => {
    expect(paceNumber(1)).toBe('01')
    expect(paceNumber(15)).toBe('15')
    expect(categoriesLabel({ kind: 'CoreFlexible', paceCategory: 0 })).toBe('01–04')
    expect(categoriesLabel({ kind: 'Stated', paceCategory: 9 })).toBe('09')
  })

  it('spells the management type the way the intake form does', () => {
    expect(managementLabel('PlanManaged')).toBe('Plan Managed')
    expect(managementLabel('AgencyManaged')).toBe('Agency Managed')
    expect(managementLabel('SelfManaged')).toBe('Self Managed')
  })

  it('says who confirmed the figures, and when', () => {
    const day = (iso: string) => iso.split('-').reverse().join('/')
    expect(confirmedLabel({ confirmedOn: '2026-09-20', confirmedByName: 'Priya' }, day)).toBe('Confirmed 20/09/2026 by Priya')
    expect(confirmedLabel({ confirmedOn: '2026-09-20' }, day)).toBe('Confirmed 20/09/2026')
    expect(confirmedLabel({ confirmedByName: 'Priya' }, day)).toBe('Confirmed by Priya')
    expect(confirmedLabel({}, day)).toBe('Not confirmed')
  })

  it('writes a day and a span out in full, the same in every browser', () => {
    expect(plain(writtenDay('2026-07-01'))).toBe('1 Jul 2026')
    expect(plain(writtenDay('2026-09-30'))).toBe('30 Sep 2026')   // never "Sept"
    expect(plain(writtenDay('2028-02-29'))).toBe('29 Feb 2028')
    expect(writtenDay(undefined)).toBe('–')
    expect(writtenDay('soon')).toBe('–')
    expect(writtenDay('2026-02-31')).toBe('–')   // not a real day
    expect(plain(writtenSpan('2026-07-01', '2027-06-30'))).toBe('1 Jul 2026 – 30 Jun 2027')
  })

  it('writes a span the way the rest of the hub does: the year once when both ends are in it, the month once when they share it (lib/dateRange.ts)', () => {
    expect(plain(writtenSpan('2026-07-01', '2026-09-30'))).toBe('1 Jul – 30 Sep 2026')
    expect(plain(writtenSpan('2026-08-14', '2026-08-17'))).toBe('14–17 Aug 2026')
    expect(plain(writtenSpan('2026-12-28', '2027-01-02'))).toBe('28 Dec 2026 – 2 Jan 2027')
    expect(plain(writtenSpan('2026-08-14', '2026-08-14'))).toBe('14 Aug 2026')
  })

  it('keeps the day, month and year of a date together, so a line can only break at the dash between two dates', () => {
    const nbsp = String.fromCharCode(160)
    expect(writtenDay('2026-07-01')).toBe(`1${nbsp}Jul${nbsp}2026`)
    expect(writtenSpan('2026-07-01', '2027-06-30')).toBe(`1${nbsp}Jul${nbsp}2026 – 30${nbsp}Jun${nbsp}2027`)   // ordinary spaces round the dash, where it may break
    expect(writtenSpan('2026-07-01', '2026-09-30')).toBe(`1${nbsp}Jul – 30${nbsp}Sep${nbsp}2026`)
  })

  it('titles a plan by its span', () => {
    expect(plain(planTitle({ planStart: '2025-07-01', planEnd: '2026-06-30' }))).toBe('Plan 1 Jul 2025 – 30 Jun 2026')
  })

  it('adds up the pools to the cent', () => {
    const pools = [{ planTotal: 0.1 }, { planTotal: 0.2 }] as FundingPlanDto['pools']
    expect(planTotal({ pools })).toBe(0.3)
    expect(planTotal({ pools: [] })).toBe(0)
  })
})
