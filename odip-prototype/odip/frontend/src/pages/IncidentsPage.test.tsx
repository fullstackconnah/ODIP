import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import IncidentsPage from './IncidentsPage'

const { mockUseIncidents, mockUseOverdueQscIncidents, mockUseFlaggedShiftNotes, mockNavigate } = vi.hoisted(() => ({
  mockUseIncidents: vi.fn(),
  mockUseOverdueQscIncidents: vi.fn(),
  mockUseFlaggedShiftNotes: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useIncidents: mockUseIncidents,
  useOverdueQscIncidents: mockUseOverdueQscIncidents,
  useUpdateIncident: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteIncident: () => ({ mutate: vi.fn(), isPending: false }),
  useFlaggedShiftNotes: mockUseFlaggedShiftNotes,
}))

// The "File incident" action navigates with router state (same mocking pattern as
// ShiftNotesSection.test.tsx's NOTES-02 prefill tests).
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function baseFlaggedNote(overrides: Partial<{
  shiftNoteId: string; shiftId: string; shiftDate: string; participantId: string; participantName: string
  staffId: string | null; staffName: string | null; flaggedCategories: string[]; excerpt: string
  createdAt: string; incidentId: string | null; startTime: string; endTime: string; endsNextDay: boolean
}> = {}) {
  return {
    shiftNoteId: 'note-1',
    shiftId: 'shift-1',
    shiftDate: '2026-09-10',
    participantId: 'p-1',
    participantName: 'Sophie Brown',
    staffId: 's-1',
    staffName: 'Ben Turner',
    flaggedCategories: ['Falls'],
    excerpt: 'She had a fall near the bathroom.',
    createdAt: '2026-09-10T09:30:00Z',
    incidentId: null,
    startTime: '08:00:00',
    endTime: '16:00:00',
    endsNextDay: false,
    ...overrides,
  }
}

function baseIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    title: 'Slip in kitchen',
    tripName: null,
    incidentType: 'Injury',
    severity: 'Low',
    status: 'Draft',
    reportedByName: 'Alex Rivera',
    incidentDateTime: '2026-09-01T10:00:00Z',
    qscReportingStatus: 'Required',
    isOverdue24h: false,
    ...overrides,
  }
}

function renderPage(initialEntry = '/incidents') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/incidents" element={<IncidentsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1', role: 'Admin' }))
  mockUseIncidents.mockReturnValue({ data: [], isLoading: false })
  mockUseOverdueQscIncidents.mockReturnValue({ data: [] })
  mockUseFlaggedShiftNotes.mockReturnValue({ data: [], isLoading: false })
  mockNavigate.mockReset()
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('IncidentsPage — QSC overdue banner (C-1)', () => {
  it('does not render a banner when there are no overdue QSC incidents', () => {
    renderPage()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the overdue QSC banner with role="alert" and destructive design tokens, not raw Tailwind reds', () => {
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ isOverdue24h: true })] })
    renderPage()

    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent(/1 incident/)
    expect(banner).toHaveTextContent(/require QSC reporting/)
    expect(banner.className).toMatch(/bg-error-container/)
    expect(banner.className).not.toMatch(/red-500/)
    expect(banner.className).not.toMatch(/text-red-400/)
  })

  it('contains a link into the incident list filtered to qsc=overdue (the alert itself stays a plain landmark, not an anchor)', () => {
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ isOverdue24h: true })] })
    renderPage()

    const banner = screen.getByRole('alert')
    expect(banner.tagName).not.toBe('A')
    const link = within(banner).getByRole('link', { name: /view overdue incidents/i })
    expect(link).toHaveAttribute('href', '/incidents?qsc=overdue')
  })

  it('offers a "Show all incidents" link back out of the filter when qsc=overdue is active', () => {
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ isOverdue24h: true })] })
    renderPage('/incidents?qsc=overdue')

    expect(screen.getByRole('link', { name: /show all incidents/i })).toHaveAttribute('href', '/incidents')
  })

  it('does not render the "Show all incidents" link when no filter is active', () => {
    renderPage()
    expect(screen.queryByRole('link', { name: /show all incidents/i })).not.toBeInTheDocument()
  })

  it('requests the isOverdueQsc filter server-side when visiting /incidents?qsc=overdue, instead of filtering client-side', () => {
    // The server is now the sole source of the overdue subset — mockUseIncidents standing in for
    // it returns only the already-overdue row, exactly as the real GetAll?isOverdueQsc=true would.
    // If the page still ran a client-side `.filter(i => i.isOverdue24h)` on top of that (double
    // filtering) the assertions below would still pass, so the params assertion is the one that
    // actually proves the server-side wiring, not the DOM assertions alone.
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ id: 'inc-1', title: 'Overdue one', isOverdue24h: true })],
      isLoading: false,
    })
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ id: 'inc-1', isOverdue24h: true })] })
    renderPage('/incidents?qsc=overdue')

    const paramsArg = mockUseIncidents.mock.calls.at(-1)?.[0]
    expect(paramsArg).toHaveProperty('isOverdueQsc', 'true')
    expect(screen.getByText('Overdue one')).toBeInTheDocument()
    expect(screen.queryByText('On-time one')).not.toBeInTheDocument()
  })

  it('final review I3(a): the QSC overdue view ignores the status filter, matching what the banner counted', () => {
    // useIncidents is a single mock, so if the page were still passing statusFilter/severityFilter
    // through to the query it would receive this pre-filtered (empty) list instead of the full one.
    mockUseIncidents.mockReturnValue({
      data: [
        baseIncident({ id: 'inc-1', title: 'Overdue one', status: 'Resolved', isOverdue24h: true }),
      ],
      isLoading: false,
    })
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ id: 'inc-1', status: 'Resolved', isOverdue24h: true })] })
    renderPage('/incidents?qsc=overdue')

    // Even though no status filter UI selection was made, the query params passed to useIncidents
    // must not carry a stale status/severity filter while in the QSC overdue view.
    const paramsArg = mockUseIncidents.mock.calls.at(-1)?.[0]
    expect(paramsArg).not.toHaveProperty('status')
    expect(paramsArg).not.toHaveProperty('severity')
    expect(paramsArg).toHaveProperty('isOverdueQsc', 'true')
    expect(screen.getByText('Overdue one')).toBeInTheDocument()
  })

  it('final review I3(b): shows a QSC-specific empty state, not the generic "no incidents" copy, when nothing is overdue', () => {
    mockUseIncidents.mockReturnValue({ data: [], isLoading: false })
    mockUseOverdueQscIncidents.mockReturnValue({ data: [] })
    renderPage('/incidents?qsc=overdue')

    expect(screen.getByText('No overdue QSC reports')).toBeInTheDocument()
    expect(screen.queryByText('No incidents reported')).not.toBeInTheDocument()
    expect(screen.queryByText(/report one to get started/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /show all incidents/i })).toHaveAttribute('href', '/incidents')
  })
})

describe('IncidentsPage — cross-domain links', () => {
  it('links the trip cell to the trip detail page when tripInstanceId is set', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ tripInstanceId: 'trip-1', tripName: 'Beach Day' })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByRole('link', { name: 'Beach Day' })).toHaveAttribute('href', '/trips/trip-1')
  })

  it('renders plain text (not a link) for the trip cell when tripInstanceId is not set', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ tripInstanceId: null, tripName: null })],
      isLoading: false,
    })
    renderPage()

    expect(screen.queryByRole('link', { name: 'Beach Day' })).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('links the participant cell to the participant detail page when involvedParticipantId is set', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ involvedParticipantId: 'p-9', involvedParticipantName: 'Priya Nair' })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByRole('link', { name: 'Priya Nair' })).toHaveAttribute('href', '/participants/p-9')
  })

  it('renders plain text (not a link) for the participant cell when involvedParticipantId is not set', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ involvedParticipantId: null, involvedParticipantName: 'Priya Nair' })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Priya Nair')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Priya Nair' })).not.toBeInTheDocument()
  })

  it('shows an em dash when no participant is involved', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ involvedParticipantId: null, involvedParticipantName: null })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('IncidentsPage — Flagged notes tab (connection map item 4)', () => {
  it('shows the Flagged notes tab, with a count, for a coordinator-gated role', () => {
    mockUseFlaggedShiftNotes.mockReturnValue({ data: [baseFlaggedNote(), baseFlaggedNote({ shiftNoteId: 'note-2' })], isLoading: false })
    renderPage()

    expect(screen.getByRole('tab', { name: 'Flagged notes (2)' })).toBeInTheDocument()
  })

  it('does not show the Flagged notes tab for a SupportWorker', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1', role: 'SupportWorker' }))
    mockUseFlaggedShiftNotes.mockReturnValue({ data: [baseFlaggedNote()], isLoading: false })
    renderPage()

    expect(screen.queryByRole('button', { name: /flagged notes/i })).not.toBeInTheDocument()
  })

  it('requests the flagged-notes queue filtered to notes without an incident', () => {
    renderPage()

    expect(mockUseFlaggedShiftNotes).toHaveBeenCalledWith({ withoutIncident: true }, { enabled: true })
  })

  it('does not query the flagged-notes queue for a SupportWorker', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1', role: 'SupportWorker' }))
    renderPage()

    expect(mockUseFlaggedShiftNotes).toHaveBeenCalledWith({ withoutIncident: true }, { enabled: false })
  })

  it('opens straight onto the Flagged notes tab when visiting /incidents?view=flagged-notes', () => {
    mockUseFlaggedShiftNotes.mockReturnValue({ data: [], isLoading: false })
    renderPage('/incidents?view=flagged-notes')

    expect(screen.getByText('No flagged notes are waiting on an incident.')).toBeInTheDocument()
  })

  it('defaults to the Incidents tab when there is no view param', () => {
    mockUseFlaggedShiftNotes.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expect(screen.queryByText('No flagged notes are waiting on an incident.')).not.toBeInTheDocument()
  })

  it('renders a row per flagged note on the Flagged notes tab, with participant/staff/flags/excerpt', async () => {
    const user = userEvent.setup()
    mockUseFlaggedShiftNotes.mockReturnValue({
      data: [baseFlaggedNote({ flaggedCategories: ['Falls', 'Injury'] })],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('tab', { name: /flagged notes/i }))

    expect(screen.getByRole('link', { name: 'Sophie Brown' })).toHaveAttribute('href', '/participants/p-1')
    expect(screen.getByText('Ben Turner')).toBeInTheDocument()
    expect(screen.getByText('falls')).toBeInTheDocument()
    expect(screen.getByText('injury')).toBeInTheDocument()
    expect(screen.getByText('She had a fall near the bathroom.')).toBeInTheDocument()
  })

  it('shows the "No flagged notes are waiting on an incident." empty state when the queue is empty', async () => {
    const user = userEvent.setup()
    mockUseFlaggedShiftNotes.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    await user.click(screen.getByRole('tab', { name: /flagged notes/i }))

    expect(screen.getByText('No flagged notes are waiting on an incident.')).toBeInTheDocument()
  })

  it('navigates to /incidents/new with a ShiftNoteIncidentPrefillState built from the row on "File incident"', async () => {
    const user = userEvent.setup()
    mockUseFlaggedShiftNotes.mockReturnValue({
      data: [baseFlaggedNote({
        shiftNoteId: 'note-9', shiftId: 'shift-9', shiftDate: '2026-09-10',
        participantId: 'p-9', participantName: 'Sophie Brown',
        flaggedCategories: ['Falls'], excerpt: 'She had a fall near the bathroom.',
        startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
      })],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('tab', { name: /flagged notes/i }))
    await user.click(screen.getByRole('button', { name: /file incident/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/incidents/new', {
      state: {
        source: 'shift-note',
        shiftNoteId: 'note-9',
        shiftId: 'shift-9',
        categories: ['Falls'],
        participantId: 'p-9',
        participantName: 'Sophie Brown',
        noteBody: 'She had a fall near the bathroom.',
        serviceDate: '2026-09-10',
        // Connection map seam follow-up: the row's own shift schedule, not a fake full-day window.
        startTime: '09:00:00',
        endTime: '17:00:00',
        endsNextDay: false,
        reportedByUserId: 'user-1',
      },
    })
  })

  it('carries an overnight flagged note\'s endsNextDay through to the incident prefill', async () => {
    const user = userEvent.setup()
    mockUseFlaggedShiftNotes.mockReturnValue({
      data: [baseFlaggedNote({
        shiftNoteId: 'note-10', shiftId: 'shift-10',
        startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true,
      })],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('tab', { name: /flagged notes/i }))
    await user.click(screen.getByRole('button', { name: /file incident/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/incidents/new', {
      state: expect.objectContaining({ startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true }),
    })
  })
})

describe('IncidentsPage — one-line QSC banner', () => {
  it('compresses to a single 40px line while keeping the headline, the reason and the link', () => {
    mockUseOverdueQscIncidents.mockReturnValue({
      data: [baseIncident({ isOverdue24h: true }), baseIncident({ id: 'inc-2', isOverdue24h: true })],
    })
    renderPage()

    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('2 incidents require QSC reporting — 24-hour deadline exceeded')
    expect(banner).toHaveTextContent('NDIS Quality and Safeguards Commission requires reportable incidents to be escalated within 24 hours.')
    expect(within(banner).getByRole('link', { name: 'View overdue incidents' })).toHaveAttribute('href', '/incidents?qsc=overdue')
    // It used to stack a headline paragraph, a reason paragraph and the link on their own lines (88px).
    expect(banner.querySelectorAll('p')).toHaveLength(1)
    expect(banner).toHaveClass('flex', 'items-center', 'min-h-10')
    // Keeps the token colours the C-1 test pins, and no raw palette colours.
    expect(banner.className).toMatch(/bg-error-container/)
  })
})

describe('IncidentsPage — header row', () => {
  it('puts the H1 and the section tabs on one header row', () => {
    renderPage()

    const h1 = screen.getByRole('heading', { level: 1, name: 'Incident Reports' })
    const tablist = screen.getByRole('tablist', { name: 'Incidents sections' })
    // PageHeader's title row: h1 group + action slot. The tabs live in that same row (spec §3).
    const titleRow = h1.parentElement?.parentElement as HTMLElement
    expect(titleRow).toContainElement(tablist)
  })

  it('keeps the H1 (and the tabs) when the Flagged notes tab is open, and drops the incident-only controls', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /flagged notes/i }))

    expect(screen.getByRole('heading', { level: 1, name: 'Incident Reports' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Incidents sections' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /report incident/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Archived' })).not.toBeInTheDocument()
  })

  it('shows the Report Incident action and the filters on the Incidents tab', () => {
    // A row present, so the empty state (which has its own "Report incident" link) is not rendered.
    mockUseIncidents.mockReturnValue({ data: [baseIncident()], isLoading: false })
    renderPage()

    expect(screen.getByRole('link', { name: /report incident/i })).toHaveAttribute('href', '/incidents/new')
    expect(screen.getByRole('radio', { name: 'Archived' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /all statuses/i })).toBeInTheDocument()
  })

  it('renders the H1 and the action but no tab strip for a role that cannot see flagged notes', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1', role: 'SupportWorker' }))
    mockUseIncidents.mockReturnValue({ data: [baseIncident()], isLoading: false })
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Incident Reports' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /report incident/i })).toBeInTheDocument()
  })
})

describe('IncidentsPage — OVERDUE QSC pill contrast', () => {
  const INDEX_CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf-8')
  type Rgb = [number, number, number]

  function tokenRgb(name: string): Rgb {
    const m = INDEX_CSS.match(new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`))
    if (!m) throw new Error(`--color-${name} is not a 6-digit hex token in index.css`)
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  function luminance([r, g, b]: Rgb): number {
    const lin = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  function contrast(a: Rgb, b: Rgb): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  it('uses the solid error token pair, at least 4.5:1 computed from the token hex values, whatever the underlying QSC status', () => {
    // The mock API's overdue incident is 'Pending', which StatusBadge would otherwise paint amber.
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ qscReportingStatus: 'Pending', isOverdue24h: true })],
      isLoading: false,
    })
    renderPage()

    const pill = screen.getByText('OVERDUE')
    const bg = pill.className.match(/bg-\[var\(--color-([\w-]+)\)\]/)?.[1]
    const fg = pill.className.match(/text-\[var\(--color-([\w-]+)\)\]/)?.[1]
    expect(bg).toBe('error-container')
    expect(fg).toBe('on-error-container')
    expect(contrast(tokenRgb(bg!), tokenRgb(fg!))).toBeGreaterThanOrEqual(4.5)
  })

  it('does not pulse: an opacity animation halves the pill and drops every token pair to about 2.5:1', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ qscReportingStatus: 'Required', isOverdue24h: true })],
      isLoading: false,
    })
    renderPage()

    const pill = screen.getByText('OVERDUE')
    expect(pill.className).not.toMatch(/animate-pulse/)
    // Even at the trough of a pulse (50% over the white card) the pair would fail — proof the
    // static, non-animated pill is the only way to hold 4.5:1.
    const white: Rgb = [255, 255, 255]
    const half = (c: Rgb): Rgb => [0, 1, 2].map(i => c[i] * 0.5 + white[i] * 0.5) as Rgb
    expect(contrast(half(tokenRgb('error-container')), half(tokenRgb('on-error-container')))).toBeLessThan(4.5)
  })

  it('leaves a non-overdue Pending status as its own amber pill and label', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ qscReportingStatus: 'Pending', isOverdue24h: false })],
      isLoading: false,
    })
    renderPage()

    expect(screen.queryByText('OVERDUE')).not.toBeInTheDocument()
    expect(screen.getByText('Pending').className).toMatch(/bg-\[var\(--color-warning-container\)\]/)
  })
})

describe('IncidentsPage — row actions', () => {
  it('reveals archive/edit actions on row hover and focus (opacity only) inside a 24px-icon cluster', () => {
    mockUseIncidents.mockReturnValue({ data: [baseIncident()], isLoading: false })
    renderPage()

    const archive = screen.getByRole('button', { name: 'Archive' })
    const cluster = archive.closest('[class*="group-hover/row:opacity-100"]') as HTMLElement
    expect(cluster).not.toBeNull()
    expect(cluster).toHaveClass('opacity-0', 'group-focus-within/row:opacity-100', '[@media(pointer:coarse)]:opacity-100')
    expect(cluster.className).not.toMatch(/(^|\s)(hidden|invisible)(\s|$)/)
    // The edit link is in the same cluster and still a real, focusable link.
    expect(within(cluster).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/incidents/inc-1/edit')
  })

  it('files an incident from a flagged note with a 24px always-visible button, not a 44px hand-rolled one', async () => {
    const user = userEvent.setup()
    mockUseFlaggedShiftNotes.mockReturnValue({ data: [baseFlaggedNote()], isLoading: false })
    renderPage()

    await user.click(screen.getByRole('tab', { name: /flagged notes/i }))
    const file = screen.getByRole('button', { name: /file incident/i })
    expect(file).toHaveClass('h-[var(--control-h-sm)]')
    expect(file.className).not.toMatch(/min-h-\[44px\]/)
    // It is the queue's only action, so it is not wrapped in the hover-revealed cluster.
    expect(file.closest('[class*="group-hover/row:opacity-100"]')).toBeNull()
  })
})
