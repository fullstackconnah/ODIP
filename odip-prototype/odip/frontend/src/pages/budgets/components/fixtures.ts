import type {
  AgreementBudgetBreakdownView,
  AgreementBudgetLine,
  AgreementBudgetPool,
  BudgetRiskRow,
  BudgetRiskTableState,
  NoBudgetEntry,
} from './viewModel'

// Small, explicit fixtures for these components' own tests. They are view-models, NOT server DTOs and NOT mock API responses: a test that wants a different state changes one field here, so a
// test cannot accidentally become an integration test, and nothing here pretends to be an endpoint's answer. The values are whole dollars, matching the funding endpoints' own shape.

/** A row in the normal case: a recorded budget, a used figure, a forecast, a next action. */
export function riskRow(overrides: Partial<BudgetRiskRow> = {}): BudgetRiskRow {
  return {
    id: 'participant-1:pool-core:2026-07-01',
    participantLabel: 'Amara Okonkwo-Bell',
    poolLabel: 'Core',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    status: 'OnTrack',
    figures: { visible: true },
    available: 2000,
    used: 640.5,
    bookedAhead: 90.25,
    forecast: 730.75,
    ...overrides,
  }
}

/** A row the privacy contract withholds the money from. */
export function hiddenRow(overrides: Partial<BudgetRiskRow> = {}): BudgetRiskRow {
  return riskRow({
    figures: { visible: false, reason: 'This role may see that a participant is near a budget, but not the figures behind it.' },
    ...overrides,
  })
}

/** A row with no recorded budget: a state, not a zero. */
export function noBudgetRow(overrides: Partial<BudgetRiskRow> = {}): BudgetRiskRow {
  return riskRow({
    id: 'participant-2:pool-core:2026-07-01',
    participantLabel: 'Bilal Nasser',
    status: 'NoBudget',
    available: null,
    used: null,
    bookedAhead: null,
    forecast: null,
    unavailableReason: 'No budget is recorded for this participant yet.',
    ...overrides,
  })
}

/** An NDIS-funded participant with no budget in force. */
export function noBudgetEntry(overrides: Partial<NoBudgetEntry> = {}): NoBudgetEntry {
  return { id: 'participant-3', participantLabel: 'Chen Wei', reason: 'No budget recorded', action: { label: 'Open funding tab', to: '/participants/participant-3?tab=funding' }, ...overrides }
}

/** A ready table state holding whatever rows it is given, in the order it is given: the sort is the server's, never this fixture's. */
export function readyTable(rows: BudgetRiskRow[], extra: { noBudget?: NoBudgetEntry[] } = {}): BudgetRiskTableState {
  return { status: 'ready', rows, ...extra }
}

/** One funding period of one pool the agreement touches, within what is left. */
export function agreementLine(overrides: Partial<AgreementBudgetLine> = {}): AgreementBudgetLine {
  return {
    periodStart: '2026-10-01',
    periodEnd: '2026-12-31',
    cost: 2355.5,
    remaining: 3120,
    withinLimit: true,
    overBy: null,
    ...overrides,
  }
}

export function agreementPool(overrides: Partial<AgreementBudgetPool> = {}): AgreementBudgetPool {
  return { poolLabel: 'Core', lines: [agreementLine()], ...overrides }
}

export function breakdown(overrides: Partial<AgreementBudgetBreakdownView> = {}): AgreementBudgetBreakdownView {
  return { status: 'ready', figures: { visible: true }, pools: [agreementPool()], notInARecordedPool: null, outsideThePlan: null, ...overrides }
}
