import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useDocumentTitle } from './useDocumentTitle'

describe('useDocumentTitle (I-4)', () => {
  afterEach(() => {
    cleanup()
    document.title = ''
  })

  it('sets document.title to the given title suffixed with the app name', () => {
    renderHook(() => useDocumentTitle('Incident Reports'))
    expect(document.title).toBe('Incident Reports — Odip')
  })

  it('updates document.title when the title argument changes', () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), { initialProps: { title: 'Trips' } })
    expect(document.title).toBe('Trips — Odip')

    rerender({ title: 'Participants' })
    expect(document.title).toBe('Participants — Odip')
  })
})
