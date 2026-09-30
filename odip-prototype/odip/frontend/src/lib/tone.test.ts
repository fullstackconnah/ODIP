import { describe, it, expect } from 'vitest'
import {
  TONE, CARD_WASH, ON_TINT, STATUS_TONE, QUIET_STATUS, TRIP_STATUS_LABELS,
  attentionOf, isTone, statusClass, statusKey, toneForStatus, toneOf, type Tone,
} from './tone'
import { TRIP_STATUSES } from '@/api/types/enums'

const TONES = Object.keys(TONE) as Tone[]
const textClass = (pair: string) => pair.split(' ').find(c => c.startsWith('text-'))
const bgClass = (pair: string) => pair.split(' ').find(c => c.startsWith('bg-'))

describe('TONE: one table decides what each colour means', () => {
  it('has the six tones, each with a solid pair, a soft wash and an ink', () => {
    expect(TONES.sort()).toEqual(['accessible', 'danger', 'info', 'neutral', 'success', 'warning'])
    for (const tone of TONES) {
      expect(TONE[tone].solid, tone).toMatch(/^bg-\[var\(--color-[a-z-]+\)\] text-\[var\(--color-[a-z-]+\)\]$/)
      expect(TONE[tone].ink, tone).toMatch(/^text-\[var\(--color-[a-z-]+\)\]$/)
      expect(TONE[tone].soft, tone).toMatch(/^bg-\[var\(--color-[a-z-]+\)\](\/\d+)?$/)
    }
  })

  it('uses only colours that are already in the palette: no hex, no rgb, no raw Tailwind colour', () => {
    for (const tone of TONES) {
      for (const cls of Object.values(TONE[tone])) expect(cls, tone).not.toMatch(/#[0-9a-f]{3,8}|rgb|amber|red-|green-|blue-/i)
    }
  })

  it('keeps the exact pairs the app renders today (a solid is a container and its on-container)', () => {
    expect(TONE.success.solid).toBe('bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]')
    expect(TONE.warning.solid).toBe('bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]')
    expect(TONE.danger.solid).toBe('bg-[var(--color-error-container)] text-[var(--color-on-error-container)]')
    expect(TONE.neutral.solid).toBe('bg-[var(--color-input)] text-[var(--color-muted-foreground)]')
    expect(TONE.info.solid).toBe('bg-[var(--color-secondary-container)] text-[var(--color-info)]')
    expect(TONE.accessible.solid).toBe('bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]')
  })

  it('never uses --color-warning as text: it is 2.15:1 on the card, so warning text is the on-container ink', () => {
    for (const tone of TONES) for (const cls of Object.values(TONE[tone])) expect(cls).not.toMatch(/text-\[var\(--color-warning\)\]/)
  })

  it('CARD_WASH is TONE.soft with the important modifier (Card paints its own fill), and a neutral tile stays on the card', () => {
    for (const tone of TONES) {
      expect(CARD_WASH[tone], tone).toBe(TONE[tone].soft && tone !== 'neutral' ? `!${TONE[tone].soft}` : '')
    }
  })

  it('ON_TINT keeps the tone\'s own text colour on the card fill, for the two tones that ask for attention', () => {
    expect(Object.keys(ON_TINT).sort()).toEqual(['danger', 'warning'])
    for (const tone of ['warning', 'danger'] as const) {
      expect(ON_TINT[tone]).toBe(`bg-[var(--color-card)] ${textClass(TONE[tone].solid)}`)
    }
  })
})

describe('aliases and helpers', () => {
  it('resolves the older tone words: error and negative are danger, positive is success', () => {
    expect(toneOf('error')).toBe('danger')
    expect(toneOf('negative')).toBe('danger')
    expect(toneOf('positive')).toBe('success')
    for (const tone of TONES) expect(toneOf(tone)).toBe(tone)
  })

  it('isTone tells a tone from a class string (StatusBadge colorMap values may be either)', () => {
    expect(isTone('danger')).toBe(true)
    expect(isTone('bg-[var(--color-input)] text-[var(--color-muted-foreground)]')).toBe(false)
    expect(isTone('constructor')).toBe(false)
  })

  it('only warning and danger ask for attention; the container is the tone\'s own', () => {
    expect(attentionOf('warning')).toBe('warning')
    expect(attentionOf('danger')).toBe('error')
    for (const tone of ['neutral', 'info', 'success', 'accessible'] as const) expect(attentionOf(tone), tone).toBeUndefined()
  })
})

describe('STATUS_TONE', () => {
  it('keys are lower case with no spaces, the way statusKey builds them', () => {
    for (const key of Object.keys(STATUS_TONE)) expect(key).toBe(statusKey(key))
    expect(statusKey('Open For Bookings')).toBe('openforbookings')
  })

  it('maps every value to a real tone', () => {
    for (const [key, tone] of Object.entries(STATUS_TONE)) expect(TONES, key).toContain(tone)
  })

  it('gives every trip status a tone (no trip status is left to the amber fallback by omission) and a sentence-case label', () => {
    for (const status of TRIP_STATUSES) {
      expect(toneForStatus(status), status).toBeDefined()
      expect(TRIP_STATUS_LABELS[status], status).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/)
    }
    expect(Object.keys(TRIP_STATUS_LABELS).sort()).toEqual([...TRIP_STATUSES].sort())
  })

  it('statusClass is the tone\'s solid pair, warning for an unknown status, and the quiet pair for a QUIET_STATUS', () => {
    expect(statusClass('Confirmed')).toBe(TONE.success.solid)
    expect(statusClass('Cancelled')).toBe(TONE.danger.solid)
    expect(statusClass('No Such Status')).toBe(TONE.warning.solid)
    expect(statusClass('No Such Status', 'neutral')).toBe(TONE.neutral.solid)
    expect([...QUIET_STATUS]).toEqual(['new'])
    expect(statusClass('New')).toBe(`${TONE.neutral.soft} ${TONE.neutral.ink}`)
    expect(bgClass(statusClass('New'))).toBe('bg-[var(--color-surface-container)]')
  })
})
