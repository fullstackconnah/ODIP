import { describe, expect, it } from 'vitest'
import { plural } from './format'

describe('plural', () => {
  // [n, singular, plural?, expected]
  it.each<[number, string, string | undefined, string]>([
    [0, 'day', undefined, '0 days'],
    [1, 'day', undefined, '1 day'],
    [2, 'day', undefined, '2 days'],
    [11, 'day', undefined, '11 days'],
    [100, 'issue', undefined, '100 issues'],
    [1.5, 'hour', undefined, '1.5 hours'],
    [0, 'person', 'people', '0 people'],
    [1, 'person', 'people', '1 person'],
    [2, 'person', 'people', '2 people'],
    [1, 'batch', 'batches', '1 batch'],
    [3, 'batch', 'batches', '3 batches'],
    [1, 'entry', 'entries', '1 entry'],
    [2, 'entry', 'entries', '2 entries'],
    [2, 'upcoming trip', undefined, '2 upcoming trips'],
  ])('plural(%s, %j, %j) is "%s"', (n, singular, pluralForm, expected) => {
    expect(pluralForm === undefined ? plural(n, singular) : plural(n, singular, pluralForm)).toBe(expected)
  })
})
