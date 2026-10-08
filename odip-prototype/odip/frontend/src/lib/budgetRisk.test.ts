import { describe, expect, it } from 'vitest'
import { alert, participantAlerts } from '@/test/fixtures/budgets'
import { budgetsAtRisk } from './budgetRisk'

// How many participants the dashboard's Budgets at risk tile counts, from the participant alerts the page already reads: each participant ONCE, in their worst state.

describe('budgetsAtRisk', () => {
  it('counts a participant with a pool over as over, and one with a pool forecast to go over as forecast over', () => {
    const aggregate = [
      participantAlerts('p-1', 'Olive Over', [alert('budget-over')]),
      participantAlerts('p-2', 'Ford Cast', [alert('budget-forecast-over')]),
      participantAlerts('p-3', 'Ford Cast Too', [alert('budget-forecast-over')]),
    ]

    expect(budgetsAtRisk(aggregate)).toEqual({ over: 1, forecastOver: 2 })
  })

  it('counts a participant once, in their worst state: one pool over and another forecast over is over, not both', () => {
    const both = participantAlerts('p-1', 'Both Pools', [alert('budget-forecast-over'), alert('budget-over', { message: 'Another pool' })])

    expect(budgetsAtRisk([both])).toEqual({ over: 1, forecastOver: 0 })
  })

  it('counts a participant with two pools over once', () => {
    const twice = participantAlerts('p-1', 'Two Over', [alert('budget-over'), alert('budget-over', { message: 'The other pool' })])

    expect(budgetsAtRisk([twice])).toEqual({ over: 1, forecastOver: 0 })
  })

  it('does not count approaching, nor the NDIA’s word, nor any other alert: they are not what the tile asks anybody to act on', () => {
    const aggregate = [
      participantAlerts('p-1', 'Approaching', [alert('budget-approaching')]),
      participantAlerts('p-2', 'Refused', [alert('budget-ndia-exhausted')]),
      participantAlerts('p-3', 'Plan ending', [alert('plan-expiring-soon', { severity: 'Warning' })]),
      participantAlerts('p-4', 'Nothing', []),
    ]

    expect(budgetsAtRisk(aggregate)).toEqual({ over: 0, forecastOver: 0 })
  })

  it('counts an over participant who is also refused by the NDIA once, as over', () => {
    const both = participantAlerts('p-1', 'Over and refused', [alert('budget-ndia-exhausted'), alert('budget-over')])

    expect(budgetsAtRisk([both])).toEqual({ over: 1, forecastOver: 0 })
  })

  it('leaves out an archived participant even if a caller passes one', () => {
    const archived = participantAlerts('p-1', 'Gone', [alert('budget-over')], { isActive: false })

    expect(budgetsAtRisk([archived])).toEqual({ over: 0, forecastOver: 0 })
  })

  it('is two real zeros for nobody at all: a count of nothing, not a missing answer', () => {
    expect(budgetsAtRisk([])).toEqual({ over: 0, forecastOver: 0 })
  })
})
