import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PageHeader } from './PageHeader'

describe('PageHeader — per-route document title (I-4)', () => {
  afterEach(() => {
    cleanup()
    document.title = ''
  })

  it('sets document.title from its title prop, so tab switching and the back button work per-route', () => {
    render(<PageHeader title="Incident Reports" />)
    expect(document.title).toBe('Incident Reports — Odip')
  })

  it('updates document.title when a different page renders with a different title', () => {
    const { rerender } = render(<PageHeader title="Trips" />)
    expect(document.title).toBe('Trips — Odip')

    rerender(<PageHeader title="Participants" />)
    expect(document.title).toBe('Participants — Odip')
  })
})
