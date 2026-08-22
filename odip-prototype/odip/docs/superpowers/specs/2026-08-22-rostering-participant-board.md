# Rostering pass 2 — participant-first board

Status: approved 2026-08-22. Amends `2026-08-21-rostering-design.md`.

Pass 1 shipped a staff-row board that hid itself when empty and had no way to add a shift
by clicking a day. Three corrections, all from using it:

1. **The board is participant-first.** A participant's week is the thing that must be
   covered; an uncovered day is the gap a coordinator is looking for. Staff rows remain
   available behind a toggle, because over-allocation and double-booking are only visible
   that way — that is what the conflict engine feeds.
2. **The grid always renders.** Pass 1 replaced the whole board with an empty state
   pointing at the patterns page whenever the week had no shifts. For a scheduling tool the
   empty grid IS the affordance. Patterns are a convenience, never a prerequisite.
3. **Empty cells are the primary way to add a shift.** Click a participant's day, get the
   shift panel prefilled with that participant and date.

## Board API

`GET /api/v1/rostering/board?weekStart=YYYY-MM-DD&groupBy=participant|staff`

`groupBy` defaults to `participant`. The response is discriminated on `groupBy`:

```ts
type RosterBoard =
  | { groupBy: 'Participant'; weekStart: string; days: string[]
      participantRows: RosterParticipantRow[]; exceptions: RosterException[] }
  | { groupBy: 'Staff'; weekStart: string; days: string[]
      staffRows: RosterStaffRow[]; unfilled: ShiftDto[]; exceptions: RosterException[] }

type RosterParticipantRow = {
  participantId: string; fullName: string
  supportRatio: string          // SupportRatio — the coverage this participant needs
  overnightSupport: string      // OvernightSupportType
  hasRestrictivePractice: boolean
  shifts: ShiftDto[]            // includes unfilled ones (staffId null)
  tripBars: TripBar[]           // from ParticipantBooking → TripInstance
  scheduledHours: number
  daysWithoutCover: number      // days in the week with no shift and no trip
}
```

`RosterStaffRow` is unchanged from pass 1.

### Rules

- **Every active participant gets a row**, whether or not they have shifts. An empty row is
  a visible coverage gap, which is the point.
- **In participant view there is no separate Unfilled lane.** An unfilled shift belongs to
  its participant's row on its day, rendered dashed. The lane is a staff-view concept and
  stays there.
- `tripBars` on a participant row explain an otherwise-empty week — the participant is away
  on a trip, not uncovered. Without this, a trip week reads as a coverage failure.
- `daysWithoutCover` counts days with neither a shift nor a trip, so the frontend can
  surface gaps without recomputing.

## Frontend

- **Never replace the grid with an empty state.** A week with no shifts renders the full
  participant × day grid with empty cells. Any guidance is an inline hint above or beside
  the grid, never instead of it.
- **Clicking an empty cell** opens `ShiftSlideOver` prefilled with that participant and
  service date (staff empty, focus on staff). In staff view, prefilled with staff and date.
  The panel already runs the debounced dry-run check, so findings appear before saving.
- **Toggle** in `WeekToolbar`: "By participant" / "By staff", participant default. Use the
  existing `ToggleGroup`. Persist the choice for the session.
- Empty cells must be keyboard reachable and activate on Enter/Space, with a clear
  `focus-visible` ring and an accessible name naming the participant and date.
- Row rhythm, sticky first column, severity markers, override indicator and the compliance
  disclosure all carry over unchanged.

## Out of scope

Collapsing inactive rows, board memoisation, and the day-at-a-time mobile layout remain
follow-ups.
