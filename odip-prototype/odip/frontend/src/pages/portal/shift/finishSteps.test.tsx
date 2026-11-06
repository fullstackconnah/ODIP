import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BreaksFold, EndedCard, HandoverStep, TravelCard } from './finishSteps'
import { HANDOVER_MAX } from './checklist'
import { EMPTY_END_DRAFT, timeQuestions, type EndDraft } from './endDraft'
import type { PortalShiftDetailDto } from '@/api/types'

vi.mock('@/api/hooks', () => ({ useShiftNotes: () => ({ data: [] }) }))

// Rostered 09:00 to 17:00 in Brisbane (UTC+10): 17:00 is 07:00Z. Started on time.
const base = {
  id: 'shift-1', timeZoneId: 'Australia/Brisbane', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
  participant: { fullName: 'Alexandra Reid' }, breaks: [], travelAsked: true, medicationsDue: [], shiftRoutines: [],
  completion: { actualStart: '2026-08-16T23:00:00Z', startTimeReason: null },
}
const shift = (over: Record<string, unknown> = {}) => ({ ...base, ...over }) as unknown as PortalShiftDetailDto
const bounds = {
  start: { stamp: '2026-08-17T09:00', min: '2026-08-17T08:45', max: '2026-08-17T09:15' },
  end: { tap: '2026-08-17T17:08', min: '2026-08-17T09:00', max: '2026-08-17T17:08' },
}

function Card({ endIso, over = {}, tapped = endIso }: { endIso: string; over?: Partial<EndDraft>; tapped?: string }) {
  const [d, setD] = useState<EndDraft>({ ...EMPTY_END_DRAFT, ...over })
  const [editStart, setEditStart] = useState(false)
  const [editEnd, setEditEnd] = useState(false)
  const s = shift()
  return (
    <EndedCard
      shift={s} endIso={endIso} tappedIso={tapped} draft={d} set={p => setD(x => ({ ...x, ...p }))}
      editStart={editStart} editEnd={editEnd} setEditStart={setEditStart} setEditEnd={setEditEnd} bounds={bounds}
      asks={timeQuestions(s, d, new Date(endIso))}
    />
  )
}

describe('EndedCard: the tap is the heading, off-roster asks why (W2)', () => {
  it('asks why a finish 8 minutes late, optional, and keeps what is typed', () => {
    render(<Card endIso="2026-08-17T07:08:00Z" />)
    expect(screen.getByRole('heading', { name: 'Ended 5:08 pm' })).toBeInTheDocument()
    const box = screen.getByLabelText('Why are you finishing 8 minutes late? (optional)')
    fireEvent.change(box, { target: { value: 'Waited for the taxi' } })
    expect(box).toHaveValue('Waited for the taxi')
  })

  it('D5: the server sends the rostered times as bare TimeOnly strings, and they read as clock times', () => {
    render(<Card endIso="2026-08-17T07:04:00Z" />)
    expect(screen.getByText('Rostered 9:00 am to 5:00 pm')).toBeInTheDocument()
  })

  it('asks about a finish 8 minutes early the same way', () => {
    render(<Card endIso="2026-08-17T06:52:00Z" tapped="2026-08-17T06:52:00Z" />)
    expect(screen.getByLabelText('Why are you finishing 8 minutes early? (optional)')).toBeInTheDocument()
  })

  it('asks nothing for a finish within 5 minutes', () => {
    render(<Card endIso="2026-08-17T07:04:00Z" />)
    expect(screen.queryByLabelText(/^Why are you finishing/)).not.toBeInTheDocument()
  })

  it('a moved finish says where it changed from and needs its own reason box', () => {
    render(<Card endIso="2026-08-17T06:50:00Z" tapped="2026-08-17T07:00:00Z" />)
    expect(screen.getByText('Changed from 5:00 pm')).toBeInTheDocument()
    expect(screen.getByLabelText('Why did your finish time change?')).toBeInTheDocument()
  })

  it('asks about a start moved to 6 minutes early, in the one general box', () => {
    render(<Card endIso="2026-08-17T07:00:00Z" over={{ startOverride: '2026-08-17T08:54' }} />)
    expect(screen.getByLabelText('Why are your times off roster? (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Why did your times change?')).toBeInTheDocument()
  })
})

describe('BreaksFold: read only once the shift has ended', () => {
  it('points at the coordinator and lists no edit control', () => {
    render(<BreaksFold shift={shift({ breaks: [{ id: 'b1', startedAt: '2026-08-17T02:00:00Z', endedAt: '2026-08-17T02:30:00Z', isRunning: false, minutes: 30, withParticipant: false }] })} />)
    fireEvent.click(screen.getByText(/^Breaks/))
    expect(screen.getByText('To fix a break, ask your coordinator.')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})

function Travel({ s = shift(), over = {} }: { s?: PortalShiftDetailDto; over?: Partial<EndDraft> }) {
  const [d, setD] = useState<EndDraft>({ ...EMPTY_END_DRAFT, ...over })
  return <TravelCard shift={s} draft={d} set={p => setD(x => ({ ...x, ...p }))} />
}

describe('TravelCard', () => {
  it('No trip clears the leg and disables its inputs; unticking brings them back', () => {
    render(<Travel over={{ preTravelMinutes: '20', preTravelKilometres: '5' }} />)
    expect(screen.getByLabelText('Minutes', { selector: '#finish-pre-min' })).toHaveValue('20')
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'No trip' })[0])
    expect(screen.getByLabelText('Minutes', { selector: '#finish-pre-min' })).toBeDisabled()
    expect(screen.getByLabelText('Minutes', { selector: '#finish-pre-min' })).toHaveValue('')
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'No trip' })[0])
    expect(screen.getByLabelText('Minutes', { selector: '#finish-pre-min' })).not.toBeDisabled()
  })

  it('shows For pay and both legs when travel is asked', () => {
    render(<Travel />)
    expect(screen.getByText('For pay')).toBeInTheDocument()
    expect(screen.getByText('Your trip to Alexandra')).toBeInTheDocument()
    expect(screen.getByText('Your trip after the shift')).toBeInTheDocument()
  })

  it('is just the kilometres when travel is not asked', () => {
    render(<Travel s={shift({ travelAsked: false })} />)
    expect(screen.getByRole('heading', { name: 'Kilometres' })).toBeInTheDocument()
    expect(screen.queryByText('For pay')).not.toBeInTheDocument()
    expect(screen.queryByText('No trip')).not.toBeInTheDocument()
  })
})

describe('HandoverStep', () => {
  function Handover({ over = {} }: { over?: Partial<EndDraft> }) {
    const [d, setD] = useState<EndDraft>({ ...EMPTY_END_DRAFT, ...over })
    return <HandoverStep noteCount={0} draft={d} set={p => setD(x => ({ ...x, ...p }))} onEditNotes={vi.fn()} />
  }

  it('Deep N1: the handover caps at 2000 characters, and the counter says so', async () => {
    render(<Handover over={{ handoverText: 'a'.repeat(HANDOVER_MAX) }} />)
    const box = screen.getByLabelText('Your handover note') as HTMLTextAreaElement
    expect(box.maxLength).toBe(2000)
    expect(screen.getByText('2000 of 2000')).toBeInTheDocument()
    await userEvent.type(box, 'b')   // the 2001st character is not accepted
    expect(box.value).toHaveLength(2000)
  })

  it('Nothing to hand over clears the text and disables the box', () => {
    render(<Handover over={{ handoverText: 'typed' }} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Nothing to hand over' }))
    expect(screen.getByLabelText('Your handover note')).toBeDisabled()
    expect(screen.getByLabelText('Your handover note')).toHaveValue('')
  })
})
