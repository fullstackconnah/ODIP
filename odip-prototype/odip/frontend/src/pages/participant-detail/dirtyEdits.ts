import { createContext } from 'react'

/**
 * Open section edits with unsaved changes, page-wide. A panel holds it while it edits a changed draft; the tab and sub-tab setters ask "Discard changes?"
 * while any hold is out. The default is a no-op, for a panel outside the participant page.
 */
export const DirtyEditsContext = createContext<{ hold: () => () => void }>({ hold: () => () => {} })
