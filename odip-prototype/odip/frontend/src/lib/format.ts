// Format helpers: how the app spells a count, a ratio and a relative time, in one place. Pure and JSX-free.
//
//   plural(2, 'day')            -> "2 days"            plural(1, 'person', 'people') -> "1 person"
//
// Every string a test pins is built from fixed words and arithmetic, never Intl: en-AU renders September as "Sep" in some ICU builds and
// "Sept" in others (the rule dateRange.ts follows). Nothing reads the clock unless you leave `now` out.

/**
 * The count and the noun that agrees with it: "1 day", "2 days", "0 days". Only exactly 1 is singular. Pass the plural for an
 * irregular noun: `plural(n, 'person', 'people')`, `plural(n, 'batch', 'batches')`, `plural(n, 'entry', 'entries')`.
 */
export function plural(n: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}
