import { describe, expect, it } from 'vitest'
import type { BudgetsAtRisk } from '@/lib/budgetRisk'
import { budgetsAtRiskItem, BUDGETS_ROUTE } from './budgetBand'

// The Budgets at risk item for the dashboard's attention band: the figure, the tone, the line and the link, and when there is no item at all.

/** Five participants have a budget in force and the NDIA has refused nobody, unless a test says otherwise. */
const risk = (over: number, forecastOver: number, rest: Partial<BudgetsAtRisk> = {}): BudgetsAtRisk => ({ over, forecastOver, tracked: 5, ndiaRefused: 0, ...rest })

describe('budgetsAtRiskItem', () => {
  it('is the number of participants over or forecast to go over, with the line that says how many of each', () => {
    const item = budgetsAtRiskItem(risk(2, 1))!

    expect(item.label).toBe('Budgets at risk')
    expect(item.count).toBe(3)
    expect(item.detail).toBe('2 over, 1 forecast to go over')
  })

  it('is danger when anybody is already over', () => {
    expect(budgetsAtRiskItem(risk(1, 0))!.tone).toBe('danger')
    expect(budgetsAtRiskItem(risk(1, 5))!.tone).toBe('danger')
  })

  it('is warning when nobody is over and some are only forecast to go over', () => {
    expect(budgetsAtRiskItem(risk(0, 2))!.tone).toBe('warning')
  })

  it('goes to the Budgets list, as the tile’s link and as the placeholder’s', () => {
    const item = budgetsAtRiskItem(risk(1, 1))!

    expect(item.action).toEqual({ label: 'Review budgets', to: '/budgets' })
    expect(item.to).toBe(BUDGETS_ROUTE)
    expect(BUDGETS_ROUTE).toBe('/budgets')
  })

  it('carries no loading or error flag: the page adds the item only once its data has arrived', () => {
    const item = budgetsAtRiskItem(risk(1, 0))!

    expect(item.loading).toBeUndefined()
    expect(item.error).toBeUndefined()
  })

  // At zero the band names an item in its All clear row: "checked, and nothing". That is only true of a budget somebody has recorded.
  it('is named in the All clear row at zero where budgets are in force, by a noun that says what was checked', () => {
    expect(budgetsAtRiskItem(risk(0, 0))).toMatchObject({ noun: 'budgets over or forecast to go over', count: 0 })
  })

  it('is no item at all when no participant has a budget in force: the band cannot say it checked what nobody recorded', () => {
    expect(budgetsAtRiskItem(risk(0, 0, { tracked: 0 }))).toBeNull()
  })

  it('is no item at zero while the NDIA says the funds ran out for somebody: an all clear about budgets would contradict it', () => {
    expect(budgetsAtRiskItem(risk(0, 0, { ndiaRefused: 1 }))).toBeNull()
  })

  it('is a tile whenever somebody is over or forecast to go over, whatever else is true', () => {
    expect(budgetsAtRiskItem(risk(1, 0, { tracked: 0, ndiaRefused: 2 }))).toMatchObject({ count: 1, tone: 'danger' })
    expect(budgetsAtRiskItem(risk(0, 1, { ndiaRefused: 1 }))).toMatchObject({ count: 1, tone: 'warning' })
  })
})
