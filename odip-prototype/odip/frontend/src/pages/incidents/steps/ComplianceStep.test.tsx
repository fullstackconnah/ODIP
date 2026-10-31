import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ComplianceStep, type ComplianceStepProps } from './ComplianceStep'

const props = (over: Partial<ComplianceStepProps> = {}): ComplianceStepProps => ({
  register: (() => ({})) as unknown as ComplianceStepProps['register'],
  setValue: (() => {}) as ComplianceStepProps['setValue'],
  status: 'Draft', errors: {}, awareAtMax: '2026-11-02T11:30',
  severity: 'Low', incidentType: 'PropertyDamage', isRestrictivePracticeAuthorised: false,
  reportableClass: 'None', commissionFinalReportRequested: false, reviewedByStaffId: '',
  familyNotified: false, supportCoordinatorNotified: false, staff: [],
  ...over,
})

describe('ComplianceStep', () => {
  it('shows the error on the "When you became aware" field', () => {
    render(<ComplianceStep {...props({ errors: { awareAt: { type: 'custom', message: 'That time is in the future.' } } })} />)

    expect(screen.getByLabelText('When you became aware')).toHaveAccessibleDescription(/That time is in the future\./)
  })
})
