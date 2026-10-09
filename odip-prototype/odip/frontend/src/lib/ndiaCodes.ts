// The NDIA's codes for a claim it refused for want of money (budget phase 2b), in the words the budget uses: V17 and V18 say the plan has not enough, V27 and V28 that the funding period has not.
// They are the only direct sign a provider gets that a participant's pool is empty (the NDIA's portal shows no budget). One list, so the reject dialog that asks for one and the claim page that prints one
// say the same thing. Any other code is kept as it was typed and has no meaning made up for it.

/** The four codes that say the funds ran out, each with what it means. */
export const NDIA_FUNDS_CODES: readonly { code: string; meaning: string }[] = [
  { code: 'V17', meaning: 'not enough in the plan' },
  { code: 'V18', meaning: 'not enough in the plan' },
  { code: 'V27', meaning: 'not enough in the funding period' },
  { code: 'V28', meaning: 'not enough in the funding period' },
]

/** What a code means in the budget's own words, or null for a code that is not one of the four (it is printed as typed). */
export function ndiaCodeMeaning(code: string): string | null {
  return NDIA_FUNDS_CODES.find(entry => entry.code === code)?.meaning ?? null
}
