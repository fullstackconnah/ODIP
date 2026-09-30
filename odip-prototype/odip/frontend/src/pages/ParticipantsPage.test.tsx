import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ParticipantsPage from './ParticipantsPage'

const { mockUseParticipants, mockDeleteMutate, mockUpdateMutate, mockUseParticipantAlertsAggregate } = vi.hoisted(() => ({
  mockUseParticipants: vi.fn(),
  mockDeleteMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
  mockUseParticipantAlertsAggregate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipants: mockUseParticipants,
  useDeleteParticipant: () => ({ mutate: mockDeleteMutate, isPending: false }),
  useUpdateParticipant: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useParticipantAlertsAggregate: mockUseParticipantAlertsAggregate,
}))

function baseParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    fullName: 'Jamie Smith',
    maskedNdisNumber: null,
    ndisNumber: null,
    planType: 'SelfManaged',
    region: 'QLD',
    mobilityAidWheelchair: false,
    isHighSupport: false,
    supportRatio: 'SharedSupport',
    isRepeatClient: false,
    isActive: true,
    serviceStreams: 'None',
    hasActiveMedications: false,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/participants']}>
      <Routes>
        <Route path="/participants" element={<ParticipantsPage />} />
        <Route path="/participants/:id" element={<div>Participant detail page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  mockUseParticipants.mockReturnValue({ data: [], isLoading: false })
  mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('ParticipantsPage — service stream badges', () => {
  it('renders stream badges for a tagged participant', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ serviceStreams: 'STA, Trip' })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('STA')).toBeInTheDocument()
    expect(screen.getByText('Trip')).toBeInTheDocument()
  })

  it('renders a dash placeholder for an untagged participant', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ serviceStreams: 'None' })],
      isLoading: false,
    })
    renderPage()

    // The NDIS Number column also renders a dash for a null number, so scope to "at least one".
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('STA')).not.toBeInTheDocument()
  })
})

describe('ParticipantsPage — medication quick button', () => {
  it('is shown only for a participant with active medications, and navigates to their medications tab', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [
        baseParticipant({ id: 'p1', fullName: 'Jamie Smith', hasActiveMedications: true }),
        baseParticipant({ id: 'p2', fullName: 'Alex Rivera', hasActiveMedications: false }),
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByRole('button', { name: /view medications for jamie smith/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /view medications for alex rivera/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view medications for jamie smith/i }))

    // Navigated to the participant-scoped medications view, not the row's own detail-page click.
    expect(screen.getByText('Participant detail page')).toBeInTheDocument()
  })
})

describe('ParticipantsPage — alerts badge column', () => {
  it('renders critical and warning counts from the aggregate endpoint, keyed by participant id', () => {
    mockUseParticipants.mockReturnValue({
      data: [
        baseParticipant({ id: 'p1', fullName: 'Jamie Smith' }),
        baseParticipant({ id: 'p2', fullName: 'Alex Rivera' }),
      ],
      isLoading: false,
    })
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [
        {
          participantId: 'p1', participantName: 'Jamie Smith', isActive: true,
          alerts: [{ type: 'plan-expired', severity: 'Critical', message: 'Plan expired', deepLinkTab: 'details', linkTo: null }],
          criticalCount: 1, warningCount: 0, infoCount: 0,
        },
        {
          participantId: 'p2', participantName: 'Alex Rivera', isActive: true,
          alerts: [],
          criticalCount: 0, warningCount: 0, infoCount: 0,
        },
      ],
      isLoading: false,
    })
    renderPage()

    // One row has a Critical badge (count 1); the other shows the empty-state dash.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('does not fetch or render the alerts column when the hook is not enabled (e.g. non-coordinator role)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    expect(screen.queryByText('Alerts')).not.toBeInTheDocument()
  })

  it('renders an Info badge for a participant whose only alerts are Info severity (previously fell through to a blank cell)', () => {
    // Give the row a real NDIS number and a tagged service stream so those columns' own
    // unrelated dash placeholders (for a null number / 'None' streams) can't be confused with
    // the alerts column's dash.
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', ndisNumber: '430123456', serviceStreams: 'STA' })],
      isLoading: false,
    })
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [
        {
          participantId: 'p1', participantName: 'Jamie Smith', isActive: true,
          alerts: [{ type: 'note-reminder', severity: 'Info', message: 'Support plan review due soon', deepLinkTab: 'support', linkTo: null }],
          criticalCount: 0, warningCount: 0, infoCount: 1,
        },
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('shows a loading placeholder rather than the "no alerts" dash while the aggregate is still fetching', () => {
    // Give the row a real NDIS number and a tagged service stream so those columns' own
    // unrelated dash placeholders (for a null number / 'None' streams) can't be confused with
    // the alerts column's dash.
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', ndisNumber: '430123456', serviceStreams: 'STA' })],
      isLoading: false,
    })
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isLoading: true })
    renderPage()

    // No dash yet — that would falsely assert "no alerts" before the request has resolved.
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})

describe('ParticipantsPage — operational register stage boundary', () => {
  it('does not render a client-side Draft control because incomplete records belong to Onboarding', () => {
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    expect(screen.queryByRole('radio', { name: 'Drafts' })).not.toBeInTheDocument()
  })

  it('requests the server-owned operational stage predicate as well as non-drafts', () => {
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    expect(mockUseParticipants).toHaveBeenLastCalledWith(expect.objectContaining({
      isDraft: 'false',
      operationalOnly: 'true',
    }))
  })

  it('renders legacy records returned by the server while incomplete onboarding records are absent', () => {
    mockUseParticipants.mockReturnValue({ data: [baseParticipant({ fullName: 'Legacy visible participant' })], isLoading: false })
    renderPage()

    expect(screen.getByText('Legacy visible participant')).toBeInTheDocument()
    expect(screen.queryByText('Incomplete onboarding participant')).not.toBeInTheDocument()
  })
})

describe('ParticipantsPage — row click', () => {
  it('still navigates to the participant detail page (no regression)', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    await user.click(screen.getByText('Jamie Smith'))

    expect(screen.getByText('Participant detail page')).toBeInTheDocument()
  })
})

describe('ParticipantsPage — status change safety', () => {
  it('renders the status pill as a read-only display, not an interactive control', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    // The Status cell shows the literal label and an accessible name, with no button/select.
    // Scope the queries to the row so the page-level Active/Inactive/Archived toggle
    // doesn't trip the "multiple elements" matcher.
    const rows = screen.getAllByRole('row')
    const jamieRow = rows.find(r => r.textContent?.includes('Jamie Smith'))!
    expect(within(jamieRow).getByText('Active')).toBeInTheDocument()
    expect(within(jamieRow).getByLabelText('Status: Active')).toBeInTheDocument()
    expect(within(jamieRow).queryByRole('combobox', { name: /active/i })).not.toBeInTheDocument()
    expect(within(jamieRow).queryByRole('button', { name: /^active$/i })).not.toBeInTheDocument()
    // The pill itself must not be a button.
    expect(within(jamieRow).queryByRole('button', { name: /status: active/i })).not.toBeInTheDocument()
  })

  it('opens a confirmation dialog that names the participant and the target status, and mutates only on confirm', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /change status for jamie smith/i }))

    // The dialog names the participant, the current state and the consequence.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    const dialog = screen.getByRole('alertdialog')
    // The title is exposed via aria-labelledby and the body message splits across nested spans,
    // so use the alertdialog's accessible name + textContent to assert the full copy.
    expect(dialog).toHaveAccessibleName(/Set Jamie Smith as Inactive/i)
    expect(dialog.textContent).toMatch(/Change\s+Jamie Smith.*status\s+from\s+Active\s+to\s+Inactive/is)

    // The confirm button is not the default "Confirm" — it names the action and the person.
    const confirmBtn = screen.getByRole('button', { name: /set jamie smith as inactive/i })
    expect(confirmBtn).toHaveTextContent(/Set as Inactive/i)

    await user.click(confirmBtn)

    // Exactly one mutation, with the full participant payload and the flipped flag.
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutate).toHaveBeenCalledWith({
      id: 'p1',
      data: { isActive: false },
    })
    // Cancel-style false positives: must not mutate on Cancel and must not mutate the
    // archive/restore path.
    expect(mockDeleteMutate).not.toHaveBeenCalled()
  })

  it('cancelling the confirmation does not mutate', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /change status for jamie smith/i }))
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(mockUpdateMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('hides the change-status button for read-only roles', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    expect(screen.queryByRole('button', { name: /change status for jamie smith/i })).not.toBeInTheDocument()
    // The status pill itself is still shown for everyone.
    const rows2 = screen.getAllByRole('row')
    const jamieRow2 = rows2.find(r => r.textContent?.includes('Jamie Smith'))!
    expect(within(jamieRow2).getByText('Active')).toBeInTheDocument()
  })

  it('flipping the wrong row never changes a different participant', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [
        baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true }),
        baseParticipant({ id: 'p2', fullName: 'Alex Rivera', isActive: true }),
      ],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /change status for alex rivera/i }))
    await user.click(screen.getByRole('button', { name: /set alex rivera as inactive/i }))

    expect(mockUpdateMutate).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutate).toHaveBeenCalledWith({
      id: 'p2',
      data: { isActive: false },
    })
  })

  it('no longer navigates when clicking the Status cell itself (row click target is the Name link, not the whole row)', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    // Clicking the Status cell (the read-only pill) must not navigate nor mutate.
    const rows3 = screen.getAllByRole('row')
    const jamieRow3 = rows3.find(r => r.textContent?.includes('Jamie Smith'))!
    await user.click(within(jamieRow3).getByText('Active'))

    expect(screen.queryByText('Participant detail page')).not.toBeInTheDocument()
    expect(mockUpdateMutate).not.toHaveBeenCalled()
  })
})

// Density review — 24px row actions revealed on row hover/focus (always shown on touch), with the
// read-only status pill and the "opens the record" chevron kept outside the fading cluster.
describe('ParticipantsPage — density row actions', () => {
  function clusterFor(name: RegExp): HTMLElement {
    return screen.getByRole('button', { name }).closest('[class*="group-hover/row:opacity-100"]') as HTMLElement
  }

  it('renders Change status and View medications as 24px controls inside one hover/focus-revealed cluster', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', hasActiveMedications: true })],
      isLoading: false,
    })
    renderPage()

    const change = screen.getByRole('button', { name: /change status for jamie smith/i })
    const meds = screen.getByRole('button', { name: /view medications for jamie smith/i })
    expect(change).toHaveClass('h-[var(--control-h-sm)]')
    expect(meds).toHaveClass('h-[var(--control-h-sm)]', 'w-[var(--control-h-sm)]', 'p-0')

    const cluster = clusterFor(/change status for jamie smith/i)
    expect(cluster).not.toBeNull()
    expect(cluster).toHaveClass('opacity-0', 'group-focus-within/row:opacity-100', '[@media(pointer:coarse)]:opacity-100')
    expect(cluster).toContainElement(meds)
    // Archive / edit from the shared ActionButtons live in the same cluster.
    expect(within(cluster).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/participants/p1/edit')
  })

  it('keeps the status pill and the chevron cue outside the revealed cluster, so they are always visible', () => {
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    const row = screen.getByText('Jamie Smith').closest('tr') as HTMLElement
    const cluster = clusterFor(/change status for jamie smith/i)
    expect(cluster).not.toContainElement(within(row).getByLabelText('Status: Active'))
    const chevron = row.querySelector('svg.lucide-chevron-right') as SVGElement
    expect(chevron).not.toBeNull()
    expect(cluster).not.toContainElement(chevron as unknown as HTMLElement)
    // It shares the row hover group, so it brightens with the row (the unnamed `group` never applied here).
    expect(chevron.getAttribute('class')).toContain('group-hover/row:text-[var(--color-foreground)]')
  })

  it('shows no actions cluster content for a read-only role without medications, and nothing extra to tab through', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseParticipants.mockReturnValue({ data: [baseParticipant({ hasActiveMedications: false })], isLoading: false })
    renderPage()

    const row = screen.getByText('Jamie Smith').closest('tr') as HTMLElement
    // Only the name link remains focusable in the row.
    expect(within(row).getAllByRole('link')).toHaveLength(1)
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
  })

  it('keeps the title row and the filter row in one block-flow wrapper so the header is 72px, not gap-spaced', () => {
    renderPage()

    const h1 = screen.getByRole('heading', { level: 1, name: 'Participants' })
    const search = screen.getByPlaceholderText(/search participants/i)
    const wrapper = h1.parentElement?.parentElement?.parentElement as HTMLElement
    expect(wrapper).toContainElement(search)
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.className).toBe('')
  })

  it('renders the NDIS number at 13px, not the 12px micro type, and keeps the Streams chips on one line', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ maskedNdisNumber: '123456789', serviceStreams: 'STA, Trip' })],
      isLoading: false,
    })
    renderPage()

    const row = screen.getByText('Jamie Smith').closest('tr') as HTMLElement
    const ndis = within(row).getByText('••••••••9')
    expect(ndis).toHaveClass('text-[13px]')
    expect(ndis).not.toHaveClass('text-xs')
    // The chips used to wrap (and their cell needed py-1 to breathe); now they sit in one row
    // (w-max) inside a capped, clipped wrapper, so the cell is padding-free like every other one.
    const cell = within(row).getByText('STA').closest('td') as HTMLElement
    expect(cell.className).not.toMatch(/(^|\s)(p|py|pt|pb)-/)
    const chips = within(row).getByText('STA').parentElement as HTMLElement
    expect(chips).toHaveClass('md:w-max')
    expect(chips.parentElement).toHaveClass('md:max-w-[10rem]', 'md:overflow-hidden')
  })
})

// Density verdict, narrow desktops: the table keeps exactly --row-h rows from 1280 up because a cell
// never wraps and the columns that don't fit are dropped, not squeezed.
describe('ParticipantsPage — narrow-desktop columns', () => {
  function headerCell(name: string): HTMLElement {
    return screen.getByRole('columnheader', { name }) as HTMLElement
  }

  it('drops Region below 1280, Support Ratio and Repeat below 2xl and Plan Type below 1792px, on the header and every row', () => {
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    const row = screen.getByText('Jamie Smith').closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    const headers = screen.getAllByRole('columnheader')
    const dropped = (label: string, cls: string) => {
      expect(headerCell(label)).toHaveClass(cls)
      // The body cell in the same column position carries the same class (a header/cell mismatch
      // would shear the table).
      const index = headers.findIndex(h => h.textContent?.includes(label))
      expect(cells[index]).toHaveClass(cls)
    }
    dropped('Support Ratio', 'md:max-2xl:hidden')
    dropped('Repeat', 'md:max-2xl:hidden')
    dropped('Plan Type', 'md:max-[1792px]:hidden')
    dropped('Region', 'md:max-xl:hidden')
    // Everything else stays: name, NDIS number, streams, status, alerts, the flags.
    for (const label of ['Name', 'NDIS Number', 'Streams', 'Status', 'High']) {
      expect(headerCell(label).className).not.toMatch(/max-(xl|2xl)/)
    }
  })

  it('cuts a long plain-string cell with an ellipsis and keeps its full text in the tooltip', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ region: 'Ipswich & West Moreton' })],
      isLoading: false,
    })
    renderPage()

    const region = screen.getByText('Ipswich & West Moreton')
    expect(region).toHaveAttribute('title', 'Ipswich & West Moreton')
    expect(region).toHaveClass('md:truncate')
    expect(region.getAttribute('style')).toContain('--cell-max: 11rem')
  })

  it('truncates the name link itself (so its focus ring is not clipped) and titles it', () => {
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    const name = screen.getByRole('link', { name: /open jamie smith profile/i })
    expect(name).toHaveAttribute('title', 'Jamie Smith')
    expect(name).toHaveClass('inline-block', 'md:truncate', 'md:max-w-[16rem]', 'focus-visible:ring-2')
    // Not wrapped in a clipping element.
    expect(name.parentElement?.tagName).toBe('TD')
  })

  it('overlays the row actions on a mouse instead of reserving column width, and never lets "Change status" wrap', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', hasActiveMedications: true })],
      isLoading: false,
    })
    renderPage()

    const change = screen.getByRole('button', { name: /change status for jamie smith/i })
    expect(change).toHaveClass('whitespace-nowrap')
    const cluster = change.closest('[class*="group-hover/row:opacity-100"]') as HTMLElement
    // Out of the flow (fine pointer, md+), hard against the left edge of its cell, over a gradient.
    expect(cluster).toHaveClass(
      'md:pointer-fine:absolute',
      'md:pointer-fine:right-full',
      'md:pointer-fine:inset-y-0',
      'md:pointer-fine:[--row-bg:var(--color-card)]',
    )
    // ...matching the hovered row's own tint while the row is hovered.
    expect(cluster.className).toContain('md:pointer-fine:group-hover/row:[--row-bg:color-mix(in_srgb,var(--color-accent)_50%,var(--color-card))]')
    // Its cell is the positioning parent and holds only the constant chevron cue.
    const cell = cluster.closest('td') as HTMLElement
    expect(cell).toHaveClass('relative')
    expect(cell.querySelector('svg.lucide-chevron-right')).not.toBeNull()
    // Still opacity-only reveal: focusable, in the tab order, clickable by coordinate.
    expect(cluster).toHaveClass('opacity-0', 'group-hover/row:opacity-100', 'group-focus-within/row:opacity-100', 'focus-within:opacity-100', '[@media(pointer:coarse)]:opacity-100')
    expect(cluster.className).not.toMatch(/pointer-events/)
    expect(cluster.className).not.toMatch(/(^|\s)(hidden|invisible)(\s|$)/)
  })

  it('renders no overlay at all for a row with nothing to offer, so hover never paints a blank patch over the cells', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseParticipants.mockReturnValue({ data: [baseParticipant({ hasActiveMedications: false })], isLoading: false })
    renderPage()

    const row = screen.getByText('Jamie Smith').closest('tr') as HTMLElement
    expect(row.querySelector('[class*="group-hover/row:opacity-100"]')).toBeNull()
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeNull()
  })
})

// Density polish (touch): the name link truncates (md:truncate), which clips its own TAP_AREA pad, so from md up on a
// coarse pointer it takes vertical padding instead and the link box itself is 44px. Below md the cell is a card, the link
// does not truncate and the DataTable's TAP_AREA_LINKS pad applies. A mouse sees neither (both are pointer-coarse:).
describe('ParticipantsPage — name link touch target', () => {
  it('pads the truncating name link to --tap-min from md up on touch, without changing its truncation or accessible name', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ fullName: 'Grace Palmer-Hughes' })],
      isLoading: false,
    })
    renderPage()

    const link = screen.getByRole('link', { name: 'Open Grace Palmer-Hughes profile' })
    expect(link).toHaveClass(
      'md:pointer-coarse:py-[calc((var(--tap-min)_-_1.25rem)_/_2)]',
      'inline-block', 'align-middle', 'md:max-w-[16rem]', 'md:truncate', 'font-medium',
    )
    expect(link).toHaveAttribute('title', 'Grace Palmer-Hughes')
    expect(link.className).not.toMatch(/before:/)
  })
})
