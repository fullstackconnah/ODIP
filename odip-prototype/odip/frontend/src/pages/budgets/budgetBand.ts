import type { BudgetsAtRisk } from '@/lib/budgetRisk'
import { plural } from '@/lib/format'
import type { BandItem } from '../dashboard/AttentionBand'

// The dashboard attention band's "Budgets at risk" item (budget phase 2b): one more BandItem for the page's existing AttentionBand, so it follows the band's own rules and needs none of its own
// (DESIGN.md, Attention band): a tall tile with a figure, a line saying what it means and a link to where it is fixed when it is above zero; a name in the one All clear row when it is at zero.
// The page adds it only once its data has arrived, so a tile is never a zero that was only waiting. And it never says "all clear" about budgets that are not there: with no budget in force for anybody
// there is no item at all, and nor is there one at zero while the NDIA says the funds ran out for somebody (the Critical Participant Alerts tile beside it carries that).

/** Where the tile goes: the Budgets list, which has every participant's pools sorted by risk. */
export const BUDGETS_ROUTE = '/budgets'

/**
 * The tile's line says what the figure counts, which is participants (DESIGN.md: a tile's line states what the count is): "3 participants: 2 over, 1 forecast to go over", and with a clause that is
 * zero dropped, the one that is left is the whole line: "3 participants over", "1 participant forecast to go over".
 */
function lineOf(over: number, forecastOver: number): string {
  if (over > 0 && forecastOver > 0) return `${plural(over + forecastOver, 'participant')}: ${over} over, ${forecastOver} forecast to go over`
  if (over > 0) return `${plural(over, 'participant')} over`
  if (forecastOver > 0) return `${plural(forecastOver, 'participant')} forecast to go over`
  return 'No participants over or forecast to go over'
}

/**
 * The figure is the number of participants with a pool already over or forecast to go over, each counted once in their worst state. The tile is danger when anybody is already over, otherwise
 * warning: an overspend that has happened outranks one that is only booked. The line says the two halves in the server's own words, and what it counts.
 *
 * At zero the band would name it among what it checked, "all clear". That is true only where a budget is in force, and not while the NDIA says the funds ran out for somebody, so there the item
 * is left out (null): the band never claims to have checked what nobody recorded, or to be clear of what the NDIA has just said. The noun says what was checked: it counts over and forecast over,
 * not "at risk" in general (approaching is not on it).
 */
export function budgetsAtRiskItem({ over, forecastOver, tracked, ndiaRefused }: BudgetsAtRisk): BandItem | null {
  const count = over + forecastOver
  if (count === 0 && (tracked === 0 || ndiaRefused > 0)) return null
  return {
    label: 'Budgets at risk',
    noun: 'budgets over or forecast to go over',
    count,
    tone: over > 0 ? 'danger' : 'warning',
    detail: lineOf(over, forecastOver),
    action: { label: 'Review budgets', to: BUDGETS_ROUTE },
    to: BUDGETS_ROUTE,
  }
}
