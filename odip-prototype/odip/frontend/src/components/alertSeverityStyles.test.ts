import { describe, expect, it } from 'vitest'
import { ALERT_TYPE_LABELS } from './alertSeverityStyles'

describe('the budget alert labels', () => {
  it('reads the pace alert as Spending fast', () => {
    expect(ALERT_TYPE_LABELS['budget-pace']).toBe('Spending fast')
  })
})
