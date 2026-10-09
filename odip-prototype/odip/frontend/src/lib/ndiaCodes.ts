// The NDIA's codes for a claim it refused for want of money (budget phase 2b), in the words the budget uses: V17 and V18 say the plan has not enough, V27 and V28 that the funding period has not.
// They are the only direct sign a provider gets that a participant's pool is empty (the NDIA's portal shows no budget). One list, so the reject dialog that asks for one and the claim page that prints one
// say the same thing. Any other code is kept as it was typed and has no meaning made up for it.

/** The four codes that say the funds ran out, each with what it means and which of the two ran out (the plan, or the funding period). */
export const NDIA_FUNDS_CODES: readonly { code: string; meaning: string; scope: string }[] = [
  { code: 'V17', meaning: 'not enough in the plan', scope: 'the plan' },
  { code: 'V18', meaning: 'not enough in the plan', scope: 'the plan' },
  { code: 'V27', meaning: 'not enough in the funding period', scope: 'the funding period' },
  { code: 'V28', meaning: 'not enough in the funding period', scope: 'the funding period' },
]

/**
 * The one sentence the Funding tab's note and the participant alert end with, which says which ran out and then the code: "not enough funds in the funding period (V27)". Any other code has no scope,
 * so it only says the funds ran out, with the code as it was. (The server words its alert the same way: NdiaRejectionCodes.ScopeOf.)
 */
export function ndiaFundsNote(code: string): string {
  const scope = NDIA_FUNDS_CODES.find(entry => entry.code === code)?.scope
  return scope ? `not enough funds in ${scope} (${code})` : `not enough funds (${code})`
}

/** What a code means in the budget's own words, or null for a code that is not one of the four (it is printed as typed). */
export function ndiaCodeMeaning(code: string): string | null {
  return NDIA_FUNDS_CODES.find(entry => entry.code === code)?.meaning ?? null
}
