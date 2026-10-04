import { format, parseISO, startOfWeek } from 'date-fns'

/**
 * The roster board at the week a day is in (the Monday of it), filtered to one participant, and to their open shifts when `unfilled` is set: where a coordinator goes to see what an approval
 * made, or to tidy what it left. The board reads `date`, `participant` and `unfilled` from the address (RosterBoardPage).
 */
export function rosterLink(date: string, participantId: string, options: { unfilled?: boolean } = {}): string {
  const monday = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const params = new URLSearchParams({ date: monday, participant: participantId })
  if (options.unfilled) params.set('unfilled', '1')
  return `/rostering?${params.toString().replace(/\+/g, '%20')}`
}
