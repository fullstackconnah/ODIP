import { describe, it, expect } from 'vitest'
import { fieldLabel, recordLabel, typeName, TYPE_FILTER_ITEMS } from './deletedRecordLabels'

const held = (o: Record<string, string>) => Object.entries(o).map(([field, old]) => ({ field, old, new: null }))
const DASH = ' –⁠ '

describe('typeName', () => {
  it.each([
    ['Shift', 'Shift'], ['ShiftPattern', 'Shift pattern'], ['StaffAvailability', 'Availability'], ['ParticipantRiskEntry', 'Risk entry'],
    ['ParticipantRoutine', 'Routine'], ['ParticipantContactRole', 'Contact role'], ['ComplianceItem', 'Compliance item'],
    ['RestrictivePractice', 'Restrictive practice'], ['RestrictivePracticeMonthlyReport', 'Restrictive practice report'], ['ClaimLineItem', 'Claim line item'],
  ])('%s is "%s"', (type, name) => expect(typeName(type)).toBe(name))

  it('splits and sentence-cases a type it does not name', () => expect(typeName('ParticipantBooking')).toBe('Participant booking'))

  it('lists All types first, then the named types A to Z', () => {
    const labels = TYPE_FILTER_ITEMS.map(i => i.label)
    expect(TYPE_FILTER_ITEMS[0]).toEqual({ value: '', label: 'All types' })
    expect(labels.slice(1)).toEqual([...labels.slice(1)].sort((a, b) => a.localeCompare(b)))
    expect(TYPE_FILTER_ITEMS.find(i => i.label === 'Routine')?.value).toBe('ParticipantRoutine')
  })
})

describe('fieldLabel', () => {
  it.each([['ServiceDate', 'Date'], ['StartTime', 'Start'], ['EndTime', 'End'], ['DayOfWeek', 'Day']])('%s is "%s"', (field, label) => expect(fieldLabel(field)).toBe(label))

  it('splits and sentence-cases a name it does not map', () => {
    expect(fieldLabel('DueDate')).toBe('Due date')
    expect(fieldLabel('Notes')).toBe('Notes')
  })
})

describe('recordLabel', () => {
  it('names a shift by its day and times, in the ISO or the en-AU form the audit wrote', () => {
    const want = `Tue 10 Nov 2026 · 9:00am${DASH}3:00pm`
    expect(recordLabel('Shift', held({ ServiceDate: '2026-11-10', StartTime: '09:00:00', EndTime: '15:00:00' }))).toBe(want)
    expect(recordLabel('Shift', held({ ServiceDate: '10/11/2026', StartTime: '9:00 AM', EndTime: '3:00 PM' }))).toBe(want)
  })

  it('names a pattern, an availability and a risk entry from their own fields', () => {
    expect(recordLabel('ShiftPattern', held({ DayOfWeek: 'Monday', StartTime: '09:00:00', EndTime: '15:00:00' }))).toBe(`Every Monday · 9:00am${DASH}3:00pm`)
    expect(recordLabel('StaffAvailability', held({ AvailabilityType: 'Unavailable', StartDateTime: '2026-11-10T04:00:00Z' }))).toBe('Unavailable · Tue 10 Nov 2026')
    expect(recordLabel('ParticipantRiskEntry', held({ Description: 'Choking risk at mealtimes' }))).toBe('Choking risk at mealtimes')
  })

  it('shows a value it cannot read as it was kept, never drops it', () => {
    expect(recordLabel('Shift', held({ ServiceDate: 'sometime', StartTime: 'noon' }))).toBe('sometime · noon')
  })

  it('falls back to the first Name, Title, Description or Notes, then to the type name', () => {
    expect(recordLabel('ComplianceItem', held({ Notes: 'n', Title: 'Fire safety' }))).toBe('Fire safety')
    expect(recordLabel('Shift', [])).toBe('Shift')
    expect(recordLabel('ParticipantRoutine', [])).toBe('Routine')
  })
})
