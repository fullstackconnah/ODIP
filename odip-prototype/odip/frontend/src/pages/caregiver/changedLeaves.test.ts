import { describe, it, expect } from 'vitest'
import { changedLeaves } from './changedLeaves'

describe('changedLeaves', () => {
  it('returns the dotted path of a changed nested field and nothing for equal ones', () => {
    const a = { keyIdentifiers: { medicareNumber: '1', pensionCardNumber: '2' }, caregiverName: 'J' }
    const b = { keyIdentifiers: { medicareNumber: '1', pensionCardNumber: '3' }, caregiverName: 'J' }
    expect(changedLeaves(a, b)).toEqual([['keyIdentifiers.pensionCardNumber', '3']])
    expect(changedLeaves(a, structuredClone(a))).toEqual([])
  })

  it('treats an array of primitives as one leaf', () => {
    expect(changedLeaves({ hidpaSupportCategories: ['a'] }, { hidpaSupportCategories: ['a', 'b'] }))
      .toEqual([['hidpaSupportCategories', ['a', 'b']]])
    expect(changedLeaves({ hidpaSupportCategories: ['a'] }, { hidpaSupportCategories: ['a'] })).toEqual([])
  })

  it('addresses a changed column of an object array by row index', () => {
    const a = { healthConditions: [{ conditionType: 'X', has: false }, { conditionType: 'Y', has: false }] }
    const b = { healthConditions: [{ conditionType: 'X', has: false }, { conditionType: 'Y', has: true }] }
    expect(changedLeaves(a, b)).toEqual([['healthConditions.1.has', true]])
  })

  it('treats an object array whose length changed as one leaf', () => {
    const a = { healthConditions: [{ conditionType: 'X', has: false }] }
    const b = { healthConditions: [{ conditionType: 'X', has: false }, { conditionType: 'Y', has: true }] }
    expect(changedLeaves(a, b)).toEqual([['healthConditions', b.healthConditions]])
  })
})
