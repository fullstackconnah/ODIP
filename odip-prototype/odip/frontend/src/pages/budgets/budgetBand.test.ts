import { describe, expect, it } from 'vitest'
import { budgetsAtRiskItem, BUDGETS_ROUTE } from './budgetBand'

// The Budgets at risk item for the dashboard's attention band: the figure, the tone, the line and the link.

describe('budgetsAtRiskItem', () => {
  it('is the number of participants over or forecast to go over, with the line that says how many of each', () => {
    const item = budgetsAtRiskItem({ over: 2, forecastOver: 1 })

    expect(item.label).toBe('Budgets at risk')
    expect(item.count).toBe(3)
    expect(item.detail).toBe('2 over, 1 forecast to go over')
  })

  it('is danger when anybody is already over', () => {
    expect(budgetsAtRiskItem({ over: 1, forecastOver: 0 }).tone).toBe('danger')
    expect(budgetsAtRiskItem({ over: 1, forecastOver: 5 }).tone).toBe('danger')
  })

  it('is warning when nobody is over and some are only forecast to go over', () => {
    expect(budgetsAtRiskItem({ over: 0, forecastOver: 2 }).tone).toBe('warning')
  })

  it('goes to the Budgets list, as the tile’s link and as the placeholder’s', () => {
    const item = budgetsAtRiskItem({ over: 1, forecastOver: 1 })

    expect(item.action).toEqual({ label: 'Review budgets', to: '/budgets' })
    expect(item.to).toBe(BUDGETS_ROUTE)
    expect(BUDGETS_ROUTE).toBe('/budgets')
  })

  it('names itself in the All clear row by a noun that reads without its tile', () => {
    expect(budgetsAtRiskItem({ over: 0, forecastOver: 0 })).toMatchObject({ noun: 'budgets at risk', count: 0 })
  })

  it('carries no loading or error flag: the page adds the item only once its data has arrived', () => {
    const item = budgetsAtRiskItem({ over: 1, forecastOver: 0 })

    expect(item.loading).toBeUndefined()
    expect(item.error).toBeUndefined()
  })
})
