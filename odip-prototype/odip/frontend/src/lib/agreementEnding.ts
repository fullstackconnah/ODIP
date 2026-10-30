import { formatServiceDate } from './planQuote'

/**
 * What the screens say of an approved agreement ending within 60 days or ended (agreement PR 2): the server's rule and words (AgreementEnding.Describe) with the house's dates. Only the
 * server keeps its ISO date: the participant banner shows the server's message, so it goes through houseEndingMessage.
 */
export function endingWords(daysLeft: number, end: string, renewalVersion?: number | null): string {
  const words = daysLeft < 0 ? `Agreement ended ${formatServiceDate(end)}: shifts stop after it`
    : daysLeft === 0 ? 'Agreement ends today'
    : daysLeft === 1 ? 'Agreement ends in 1 day'
    : `Agreement ends in ${daysLeft} days`
  return renewalVersion ? `${words}. Renewal v${renewalVersion} is waiting for approval` : words
}

/** The Agreements page's status badge for an ending agreement: short, since the table has the dates. */
export function endingBadgeWords(daysLeft: number): string {
  return daysLeft < 0 ? 'Ended' : daysLeft === 0 ? 'Ends today' : daysLeft === 1 ? 'Ends in 1 day' : `Ends in ${daysLeft} days`
}

/** The server's alert message with its ISO end date said as the house date ("Thu 12 Nov 2026"). */
export function houseEndingMessage(message: string): string {
  return message.replace(/\d{4}-\d{2}-\d{2}/, iso => formatServiceDate(iso))
}
