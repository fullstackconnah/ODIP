import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MissedMedicationGuidance } from './MissedMedicationGuidance'
import type { ProviderSettingsDto } from '@/api/types'

const { mockUseProviderSettings } = vi.hoisted(() => ({
  mockUseProviderSettings: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useProviderSettings: mockUseProviderSettings,
}))

function makeProviderSettings(overrides: Partial<ProviderSettingsDto> = {}): ProviderSettingsDto {
  return {
    id: 'provider-1', registrationNumber: '123', abn: '456', organisationName: 'Test Org',
    address: '1 Test St', state: 'VIC', gstRegistered: true, isPaceProvider: false,
    bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null,
    managerName: 'Priya Sharma', managerPhone: '0412 345 007',
    ...overrides,
  }
}

function setProviderSettings(overrides: Partial<ProviderSettingsDto> = {}) {
  mockUseProviderSettings.mockReturnValue({ data: makeProviderSettings(overrides) })
}

const baseEvent = {
  outcome: 'Refused' as const,
  participantName: 'Sophie Brown',
  medicationName: 'Levetiracetam',
}

describe('MissedMedicationGuidance outcome gating', () => {
  it.each(['Refused', 'Withheld', 'Missed', 'WrongMedication'] as const)('renders for a %s outcome', (outcome) => {
    setProviderSettings()
    render(<MissedMedicationGuidance event={{ ...baseEvent, outcome }} />)

    expect(screen.getByText(/what to do now/i)).toBeInTheDocument()
  })

  it('does not render for an Administered outcome', () => {
    setProviderSettings()
    const { container } = render(<MissedMedicationGuidance event={{ ...baseEvent, outcome: 'Administered' }} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the generic reference version when no event is given', () => {
    setProviderSettings()
    render(<MissedMedicationGuidance />)

    expect(screen.getByText(/what to do if a medication is missed, refused, withheld, or given wrong/i)).toBeInTheDocument()
  })
})

describe('MissedMedicationGuidance manager contact', () => {
  it('shows the configured manager as a tap-to-call link', () => {
    setProviderSettings({ managerName: 'Priya Sharma', managerPhone: '0412 345 007' })
    render(<MissedMedicationGuidance event={baseEvent} />)

    const link = screen.getByRole('link', { name: /priya sharma.*0412 345 007/i })
    expect(link).toHaveAttribute('href', 'tel:0412345007')
  })

  it('falls back to a "see your team leader" message, with an admin pointer, when unset', () => {
    setProviderSettings({ managerName: null, managerPhone: null })
    render(<MissedMedicationGuidance event={baseEvent} />)

    expect(screen.getByText(/no manager contact is configured for this organisation — see your team leader/i)).toBeInTheDocument()
    expect(screen.getByText(/settings.*provider settings.*manager contact/i)).toBeInTheDocument()
  })

  it('falls back when only one of name/phone is configured', () => {
    setProviderSettings({ managerName: 'Priya Sharma', managerPhone: null })
    render(<MissedMedicationGuidance event={baseEvent} />)

    expect(screen.getByText(/no manager contact is configured/i)).toBeInTheDocument()
  })
})

describe('MissedMedicationGuidance health advice line', () => {
  it('shows Nurse-on-Call plus the national fallback for a VIC tenant', () => {
    setProviderSettings({ state: 'VIC' })
    render(<MissedMedicationGuidance event={baseEvent} />)

    expect(screen.getByRole('link', { name: /nurse-on-call.*1300 60 60 24/i })).toHaveAttribute('href', 'tel:1300606024')
    expect(screen.getByText(/national fallback/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1800 022 222' })).toHaveAttribute('href', 'tel:1800022222')
  })

  it('shows only the national line, with no fallback line, for a non-VIC tenant', () => {
    setProviderSettings({ state: 'NSW' })
    render(<MissedMedicationGuidance event={baseEvent} />)

    expect(screen.getByRole('link', { name: /national health advice line.*1800 022 222/i })).toBeInTheDocument()
    expect(screen.queryByText(/national fallback/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/nurse-on-call/i)).not.toBeInTheDocument()
  })

  it('shows only the national line for an unset state', () => {
    setProviderSettings({ state: undefined as unknown as string })
    render(<MissedMedicationGuidance event={baseEvent} />)

    expect(screen.getByRole('link', { name: /national health advice line.*1800 022 222/i })).toBeInTheDocument()
  })
})

describe('MissedMedicationGuidance pharmacy contact', () => {
  it('shows a "call the pharmacy on ..." link when PharmacyPhone is present', () => {
    setProviderSettings()
    render(<MissedMedicationGuidance event={{ ...baseEvent, pharmacyName: 'Chemist Warehouse', pharmacyPhone: '03 9123 4567' }} />)

    const link = screen.getByRole('link', { name: /call the pharmacy on 03 9123 4567.*chemist warehouse/i })
    expect(link).toHaveAttribute('href', 'tel:0391234567')
  })

  it('omits the pharmacy call link when PharmacyPhone is absent, but still shows the packaging-check instruction', () => {
    setProviderSettings()
    render(<MissedMedicationGuidance event={baseEvent} />)

    expect(screen.queryByText(/call the pharmacy on/i)).not.toBeInTheDocument()
    expect(screen.getByText(/pharmacy's name and phone number are usually printed on the label/i)).toBeInTheDocument()
  })

  it('tailors the packaging-check wording to a Webster pack when specified', () => {
    setProviderSettings()
    render(<MissedMedicationGuidance event={{ ...baseEvent, packaging: 'WebsterPack' }} />)

    expect(screen.getByText(/check the webster pack label/i)).toBeInTheDocument()
  })
})

describe('MissedMedicationGuidance always-present escalations', () => {
  it('always shows the Poisons Information Centre number', () => {
    setProviderSettings()
    render(<MissedMedicationGuidance event={baseEvent} />)

    expect(screen.getByRole('link', { name: /poisons information centre.*13 11 26/i })).toHaveAttribute('href', 'tel:131126')
  })

  it('always shows the 000 emergency line as the last step', () => {
    setProviderSettings()
    render(<MissedMedicationGuidance event={baseEvent} />)

    expect(screen.getByRole('link', { name: /call 000 immediately/i })).toHaveAttribute('href', 'tel:000')
  })
})

// MED-01 research doc: never suggest give-the-missed-dose-now/double-up/skip timing or quantity
// guidance, and never point to a generic search engine — every escalation routes through a
// qualified line only.
describe('MissedMedicationGuidance contains no dosing advice', () => {
  const FORBIDDEN_PATTERNS = [
    /give.{0,20}(the )?(missed|extra) dose/i,
    /double([- ]| the )?(up|dose)/i,
    /skip (the|this|it)/i,
    /google/i,
    /search (the web|online)/i,
  ]

  it('never contains dosing-advice or search-engine language, for any trigger outcome or the reference view', () => {
    setProviderSettings()
    const outcomes = ['Refused', 'Withheld', 'Missed', 'WrongMedication'] as const
    for (const outcome of outcomes) {
      const { container, unmount } = render(
        <MissedMedicationGuidance
          event={{ ...baseEvent, outcome, pharmacyName: 'Chemist Warehouse', pharmacyPhone: '03 9123 4567', packaging: 'WebsterPack' }}
        />,
      )
      const text = container.textContent ?? ''
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(text).not.toMatch(pattern)
      }
      unmount()
    }

    const { container: referenceContainer } = render(<MissedMedicationGuidance />)
    const referenceText = referenceContainer.textContent ?? ''
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(referenceText).not.toMatch(pattern)
    }
  })
})
