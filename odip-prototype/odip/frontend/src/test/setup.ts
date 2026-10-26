import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// The deploy re-runs this suite inside a loaded Docker build, where findBy*/waitFor's 1000 ms default is too tight for chains of timers and renders.
configure({ asyncUtilTimeout: 3000 })

// jsdom has no scrollIntoView; code that scrolls a refused section into view needs a no-op.
// Node-environment test files have no Element at all.
if (typeof Element !== 'undefined') Element.prototype.scrollIntoView ??= () => {}
