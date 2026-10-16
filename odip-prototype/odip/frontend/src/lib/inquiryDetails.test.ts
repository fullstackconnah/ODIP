import { describe, expect, it } from 'vitest'
import {
  addressLine, convertRefusal, detailFacts, FACT_LIST_WRAP, fullName, hasFullAddress, hasStoredDetails, inquiryErrors, INQUIRY_MESSAGES, mainContactFacts, startIntakeReason,
  type InquiryFormValues,
} from './inquiryDetails'

const TODAY = '2026-10-16'
const form = (overrides: Partial<InquiryFormValues> = {}): InquiryFormValues => ({
  firstName: 'Ari', phone: '', email: '', contactIsParticipant: false, contactRole: '', dateOfBirth: '', ndisNumber: '', addressPostcode: '',
  planType: '', planStartDate: '', planEndDate: '', ...overrides,
})
const refusal = (errors: Record<string, string[]>) => Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status: 400, data: { errors } } })
const W = { addressStreet: '12 Smith St', addressSuburb: 'Parramatta', addressState: 'NSW', addressPostcode: '2150' }

describe('names (L1)', () => {
  it('joins and trims, and never leaves a double or trailing space', () => {
    expect(fullName('Jo', null)).toBe('Jo')
    expect(fullName(' Ari ', ' Walsh ')).toBe('Ari Walsh')
    expect(fullName('Jo', '')).toBe('Jo')
    expect(fullName(null, null)).toBe('')
  })
})

describe('the address', () => {
  it('Start intake needs all four parts', () => {
    expect(hasFullAddress(W)).toBe(true)
    expect(hasFullAddress({ ...W, addressState: ' ' })).toBe(false)
    expect(hasFullAddress({})).toBe(false)
  })

  it('reads on one line, blanks left out', () => {
    expect(addressLine(W)).toBe('12 Smith St, Parramatta NSW 2150')
    expect(addressLine({ addressSuburb: 'Parramatta', addressPostcode: '2150' })).toBe('Parramatta 2150')
    expect(addressLine({})).toBe('')
  })
})

describe('the client mirror of the save rules (SHAPE section 10)', () => {
  it('needs only the first name', () => {
    expect(inquiryErrors(form(), null, TODAY)).toEqual({})
    expect(inquiryErrors(form({ firstName: ' ' }), null, TODAY)).toEqual({ firstName: "Add the participant's first name." })
  })

  it('refuses each bad detail on its own field', () => {
    expect(inquiryErrors(form({ phone: 'call me' }), null, TODAY)).toEqual({ phone: INQUIRY_MESSAGES.phone })
    expect(inquiryErrors(form({ email: 'a b@c.d' }), null, TODAY)).toEqual({ email: INQUIRY_MESSAGES.email })
    expect(inquiryErrors(form({ dateOfBirth: '2026-10-17' }), null, TODAY)).toEqual({ dateOfBirth: "The date of birth can't be in the future." })
    expect(inquiryErrors(form({ dateOfBirth: '1900-01-01' }), null, TODAY)).toEqual({ dateOfBirth: "Check the year: that's more than 120 years ago." })
    expect(inquiryErrors(form({ addressPostcode: '215' }), null, TODAY)).toEqual({ addressPostcode: 'Postcode must be exactly 4 digits.' })
    expect(inquiryErrors(form({ planStartDate: '2026-07-01', planEndDate: '2026-06-30' }), null, TODAY)).toEqual({ planEndDate: "The plan end can't be before the plan start." })
  })

  it('the NDIS number is 9 digits once spaces are stripped', () => {
    expect(inquiryErrors(form({ ndisNumber: '430 123 456' }), null, TODAY)).toEqual({})
    expect(inquiryErrors(form({ ndisNumber: '430 123 45' }), null, TODAY)).toEqual({ ndisNumber: 'Enter the 9-digit NDIS number, like 430 123 456.' })
  })

  it('an unchanged legacy phone passes; the same phone with "their own contact" newly ticked is checked', () => {
    const legacy = '0412 555 010 after 3pm'
    const stored = { phone: legacy, email: '', contactIsParticipant: false }
    expect(inquiryErrors(form({ phone: legacy }), stored, TODAY)).toEqual({})
    expect(inquiryErrors(form({ phone: legacy, contactIsParticipant: true }), stored, TODAY)).toEqual({ phone: INQUIRY_MESSAGES.phone })
    expect(inquiryErrors(form({ phone: 'call' }), stored, TODAY)).toEqual({ phone: INQUIRY_MESSAGES.phone })
  })

  it("checks the main contact's role against the enquiry's age and plan, unless they are their own contact", () => {
    expect(inquiryErrors(form({ contactRole: 'PlanNominee', dateOfBirth: '2014-03-12' }), null, TODAY)).toEqual({
      contactRole: 'Plan Nominee is not available for a participant under 18 — use Child Representative instead.',
    })
    expect(inquiryErrors(form({ contactRole: 'PlanNominee', dateOfBirth: '2014-03-12', contactIsParticipant: true }), null, TODAY)).toEqual({})
  })
})

describe("Start intake's reasons (G2)", () => {
  it('names what is missing and links to it', () => {
    expect(startIntakeReason({ id: 'inq 1', hasAddress: true, contactNeedsName: false })).toBeNull()
    expect(startIntakeReason({ id: 'inq 1', hasAddress: false })).toMatchObject({ text: 'Add an address to start intake', to: '/participants/new-inquiry?id=inq%201&focus=address' })
    expect(startIntakeReason({ id: 'inq-1', hasAddress: true, contactNeedsName: true })).toMatchObject({ text: "Add the main contact's name to start intake", action: 'Add the name', to: '/participants/new-inquiry?id=inq-1&focus=contact' })
    expect(startIntakeReason({ id: 'inq-1', contactNeedsName: true })).toMatchObject({ text: "Add an address and the main contact's name to start intake", action: 'Add the address and name', to: '/participants/new-inquiry?id=inq-1&focus=address' })
  })

  it('the fact list stacks label over value below sm', () => {
    expect(FACT_LIST_WRAP).toContain('grid-cols-1!')
    expect(FACT_LIST_WRAP).toContain('sm:grid-cols-[10rem_minmax(0,1fr)]!')
  })

  it("reads Start intake's 400 in words", () => {
    const address = "Add Ari Walsh's full address before starting intake: street, suburb, state and postcode."
    const name = "Add the main contact's name before starting intake."
    expect(convertRefusal(refusal({ addressSuburb: ['x'], addressState: ['x'] }), 'Ari Walsh')).toBe(address)
    expect(convertRefusal(refusal({ contactFirstName: ['x'] }), 'Ari Walsh')).toBe(name)
    expect(convertRefusal(refusal({ addressStreet: ['x'], contactLastName: ['x'] }), 'Ari Walsh')).toBe("Add Ari Walsh's full address (street, suburb, state and postcode) and the main contact's name before starting intake.")
    expect(convertRefusal(refusal({ other: ['x'] }), 'Ari Walsh')).toBeNull()
  })
})

describe('the read-only facts (E5, E6)', () => {
  it('a named main contact, a self contact, and an empty one', () => {
    expect(mainContactFacts({ contactFirstName: 'Sarah', contactLastName: 'Walsh', contactRelationship: 'Mother', contactRole: 'Guardian', phone: '0412 555 061', email: 's@example.com' }))
      .toEqual([
        { label: 'Name', value: 'Sarah Walsh' }, { label: 'Relationship', value: 'Mother' }, { label: 'Role', value: 'Guardian' },
        { label: 'Phone', value: '0412 555 061' }, { label: 'Email', value: 's@example.com' },
      ])
    expect(mainContactFacts({ contactIsParticipant: true, phone: '0412 555 061' })).toEqual([
      { label: 'Contact', value: 'Their own contact' }, { label: 'Phone', value: '0412 555 061' }, { label: 'Email', value: undefined },
    ])
    expect(mainContactFacts({}).every(f => !f.value)).toBe(true)
  })

  it('the details, and whether there are any', () => {
    expect(detailFacts({ ...W, dateOfBirth: '2014-03-12', ndisNumber: '430123456', planType: 'PlanManaged', planStartDate: '2026-07-01', planEndDate: '2027-06-30' })).toEqual([
      { label: 'Address', value: '12 Smith St, Parramatta NSW 2150' }, { label: 'Date of birth', value: '12 Mar 2014' }, { label: 'NDIS number', value: '430123456' },
      { label: 'Plan management', value: 'Plan-managed' }, { label: 'Plan dates', value: '1 Jul 2026 – 30 Jun 2027' },
    ])
    expect(hasStoredDetails({})).toBe(false)
    expect(hasStoredDetails({ ndisNumber: '430123456' })).toBe(true)
  })
})
