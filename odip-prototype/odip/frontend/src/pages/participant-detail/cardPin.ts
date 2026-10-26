import { createContext } from 'react'

/**
 * Lets an open edit panel hold its card where it is. `ShortCards` files a card at the top level when its section has data and inside the
 * "Not recorded" fold when it has none, so a refetch that flips `has` would move it to the other parent, remount it and lose the draft.
 * `pin()` is called while a panel edits (it returns the unpin); `held(id, has)` is the placement to use for a card meanwhile.
 * The default is a no-op, for a panel outside ShortCards.
 */
export type CardPin = { pin: () => () => void; held: (id: string, has: boolean) => boolean }
export const CardPinContext = createContext<CardPin>({ pin: () => () => {}, held: (_id, has) => has })
