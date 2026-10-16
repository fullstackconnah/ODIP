import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PENDING_ROLES, blankContact, contactRowErrors, contactRowOf, contactsPayload, enquirerContact, isBlankContact, serverContactErrors, type ContactRow,
} from './inquiryContacts'

const row = (overrides: Partial<ContactRow> = {}): ContactRow => ({ ...blankContact(), ...overrides })
const refusal = (errors: Record<string, string[]>) => Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status: 400, data: { errors } } })

describe('pending contacts on the enquiry form', () => {
  it('offers every role but Plan Manager, and a new row is Next of Kin with unique keys', () => {
    expect(PENDING_ROLES).toContain('NextOfKin')
    expect(PENDING_ROLES).toContain('ProviderContact')
    expect(PENDING_ROLES).not.toContain('PlanManager')
    expect(blankContact().role).toBe('NextOfKin')
    expect(blankContact().key).not.toBe(blankContact().key)
  })

  it('a row with only its default role is blank', () => {
    expect(isBlankContact(blankContact())).toBe(true)
    expect(isBlankContact(row({ role: 'Guardian' }))).toBe(true)
    expect(isBlankContact(row({ relationship: 'Aunt' }))).toBe(false)
  })

  it('contactsPayload drops blank rows, trims, sends blanks as null, keeps a loaded row\'s notes and the order', () => {
    const loaded = contactRowOf({ role: 'Guardian', firstName: 'Maria', lastName: 'Lopez', phone: null, email: 'm@example.com', relationship: null, notes: 'Works nights' })
    expect(contactsPayload([row(), row({ firstName: ' Tom ', lastName: 'Ng', phone: ' ' }), loaded])).toEqual([
      { role: 'NextOfKin', firstName: 'Tom', lastName: 'Ng', relationship: null, phone: null, email: null, notes: null },
      { role: 'Guardian', firstName: 'Maria', lastName: 'Lopez', relationship: null, phone: null, email: 'm@example.com', notes: 'Works nights' },
    ])
  })

  it('contactRowErrors: a non-blank row needs both names; a blank row needs nothing', () => {
    const half = row({ firstName: 'Tom' })
    const empty = row()
    expect(contactRowErrors([half, empty])).toEqual({ [half.key]: { lastName: 'Add their last name.' } })
    const noFirst = row({ phone: '0412' })
    expect(contactRowErrors([noFirst])).toEqual({ [noFirst.key]: { firstName: 'Add their first name.', lastName: 'Add their last name.' } })
  })

  it('serverContactErrors maps contacts[i].field onto the i-th row that was sent, whatever the key\'s case', () => {
    const blank = row(), a = row({ firstName: 'A', lastName: 'One' }), b = row({ firstName: 'B', lastName: 'Two' })
    expect(serverContactErrors(refusal({ 'contacts[1].phone': ['Enter a phone number, like 0412 345 678.'] }), [blank, a, b]))
      .toEqual({ [b.key]: { phone: 'Enter a phone number, like 0412 345 678.' } })
    expect(serverContactErrors(refusal({ 'Contacts[0].Email': ['Enter a full email address, like name@example.com.'] }), [blank, a, b]))
      .toEqual({ [a.key]: { email: 'Enter a full email address, like name@example.com.' } })
  })

  it('enquirerContact copies only the phone and email (the enquiry\'s name is usually the participant\'s)', () => {
    const copy = enquirerContact({ phone: '0412', email: 'a@b.co' })
    expect(copy).toMatchObject({ phone: '0412', email: 'a@b.co', firstName: '', lastName: '', role: 'NextOfKin' })
  })

  // Live ODIP is plain HTTP on the LAN, which is not a secure context, so crypto.randomUUID is undefined there.
  describe('on plain HTTP (no crypto.randomUUID)', () => {
    beforeEach(() => vi.stubGlobal('crypto', {}))
    afterEach(() => vi.unstubAllGlobals())

    it('creates rows without throwing, each with its own key', () => {
      const dto = { role: 'Guardian' as const, firstName: 'Maria', lastName: 'Lopez', relationship: null, phone: null, email: null, notes: null }
      const keys = [blankContact().key, contactRowOf(dto).key, enquirerContact({ phone: '', email: '' }).key]
      expect(new Set(keys).size).toBe(3)
    })
  })
})
