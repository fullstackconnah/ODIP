// Restrictive practice monthly reports for the mock API: the lines, lodge (POST), undo (DELETE) and the CSV. Every name and figure is fictional.
// Mirrors RestrictivePracticeReportsController (#639). Captures switch state with POST /mock/rp-reports/state:
//   { mode: 'default' | 'empty' }  empty = no lines at all
//   { conflict: true | false }     true = the next lodge answers 409 (the month was lodged elsewhere)
// The fixture is dated for a clock pinned to 2026-11-04: October is due Fri 6 Nov, September was due Wed 7 Oct.

const ALEX = { participantId: 'p-0001', participantName: 'Alex Demo' }
const JORDAN = { participantId: 'p-0002', participantName: 'Jordan Demo' }

const PRACTICES = [
  { id: 'rp-alex', ...ALEX, type: 'PhysicalRestraint', description: 'Hands-on guiding during transitions', useKind: 'Routine', medicine: null },
  { id: 'rp-jordan', ...JORDAN, type: 'ChemicalRestraint', description: 'As-needed sedation', useKind: 'AsNeeded', medicine: 'Midazolam 5 mg' },
]

const lodged = { id: 'rep-aug', reportType: 'NotUsed', variedKind: null, variedAlsoUnauthorised: null, useCount: null, note: null, lodgedOn: '2026-09-03', lodgedByName: 'Sam Coordinator' }

const fixtureLines = () => [
  { restrictivePracticeId: 'rp-alex', ...ALEX, practiceType: 'PhysicalRestraint', practiceDescription: PRACTICES[0].description, useKind: 'Routine', month: '2026-10-01', dueOn: '2026-11-06', dueCountedWithoutHolidays: false, state: 'Due', suggestedType: null, uses: [], report: null },
  { restrictivePracticeId: 'rp-alex', ...ALEX, practiceType: 'PhysicalRestraint', practiceDescription: PRACTICES[0].description, useKind: 'Routine', month: '2026-09-01', dueOn: '2026-10-07', dueCountedWithoutHolidays: false, state: 'Overdue', suggestedType: null, uses: [], report: null },
  { restrictivePracticeId: 'rp-alex', ...ALEX, practiceType: 'PhysicalRestraint', practiceDescription: PRACTICES[0].description, useKind: 'Routine', month: '2026-08-01', dueOn: '2026-09-04', dueCountedWithoutHolidays: false, state: 'Lodged', suggestedType: null, uses: [], report: lodged },
  {
    restrictivePracticeId: 'rp-jordan', ...JORDAN, practiceType: 'ChemicalRestraint', practiceDescription: PRACTICES[1].description, useKind: 'AsNeeded', month: '2026-10-01', dueOn: '2026-11-06', dueCountedWithoutHolidays: false,
    state: 'Due', suggestedType: 'UsesReported',
    uses: [
      { localDateTime: '2026-10-12T14:30:00', incidentReportId: null, medicationAdministrationId: 'adm-1' },
      { localDateTime: '2026-10-21T20:05:00', incidentReportId: 'inc-0001', medicationAdministrationId: null },
    ],
    report: null,
  },
]

const practiceDto = (p) => ({
  id: p.id, participantId: p.participantId, type: p.type, description: p.description, authorisedBy: 'Dr Chen', authorisationDate: '2026-03-01', authorisationEndDate: null, useKind: p.useKind,
  firstUsedOn: '2026-03-05', interimBspDate: null, comprehensiveBspDate: null, earliestRecordedUseDate: null, interimBspDueOn: null, comprehensiveBspDueOn: null,
  interimBspState: 'NotStarted', comprehensiveBspState: 'NotStarted', reviewDate: null, relatedMedicationId: p.medicine ? 'med-1' : null, relatedMedicationName: p.medicine,
  isActive: true, isAuthorised: true, createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z',
})

function create({ respond, failEnvelope }) {
  let mode = 'default'
  let conflict = false
  let lines = fixtureLines()
  const key = (l) => `${l.restrictivePracticeId}|${l.month}`
  const visible = () => (mode === 'empty' ? [] : lines)

  return {
    get: [
      ['restrictive-practice-reports', (searchParams) => {
        const pid = searchParams && searchParams.get('participantId')
        return visible().filter((l) => !pid || l.participantId === pid)
      }],
      ['restrictive-practice-reports/csv', (searchParams) => {
        const month = (searchParams && searchParams.get('month')) || ''
        return `Participant,Practice,Month\r\n${visible().filter((l) => l.month === month).map((l) => `${l.participantName},${l.practiceType},${l.month}`).join('\r\n')}`
      }],
      ['participants/:id/restrictive-practices', (id) => PRACTICES.filter((p) => p.participantId === id).map(practiceDto)],
    ],
    post: [
      ['restrictive-practice-reports', (body) => {
        const line = lines.find((l) => key(l) === `${body.restrictivePracticeId}|${body.month}`)
        if (!line) return respond(404, failEnvelope(null, ['That monthly report line was not found.']))
        if (conflict || line.report) return respond(409, failEnvelope(null, ['This month has already been recorded as lodged.']))
        line.report = {
          id: `rep-${Date.now()}`, reportType: body.reportType, variedKind: body.variedKind ?? null, variedAlsoUnauthorised: body.variedAlsoUnauthorised ?? null,
          useCount: body.reportType === 'UsesReported' ? line.uses.length : null, note: body.note ?? null, lodgedOn: body.lodgedOn, lodgedByName: 'Sam Coordinator',
        }
        line.state = 'Lodged'
        return line.report
      }],
      ['mock/rp-reports/state', (body) => {
        if (body.mode === 'default' || body.mode === 'empty') mode = body.mode
        if ('conflict' in body) conflict = !!body.conflict
        if (body.reset) { lines = fixtureLines(); conflict = false; mode = 'default' }
        return { mode, conflict }
      }],
    ],
    delete: [
      ['restrictive-practice-reports/:id', (id) => {
        const line = lines.find((l) => l.report && l.report.id === id)
        if (!line) return respond(404, failEnvelope(null, ['That report was not found.']))
        const original = fixtureLines().find((l) => key(l) === key(line))
        line.report = null
        line.state = original && original.state !== 'Lodged' ? original.state : 'Due'
        return true
      }],
    ],
  }
}

module.exports = { create }
