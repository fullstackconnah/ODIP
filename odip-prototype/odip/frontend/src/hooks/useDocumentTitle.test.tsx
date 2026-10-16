import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useDocumentTitle } from './useDocumentTitle'

describe('useDocumentTitle (I-4)', () => {
  afterEach(() => {
    cleanup()
    document.title = ''
  })

  it('sets document.title to the given title after the app name', () => {
    renderHook(() => useDocumentTitle('Incident Reports'))
    expect(document.title).toBe('Bunya Support · Incident Reports')
  })

  it('updates document.title when the title argument changes', () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), { initialProps: { title: 'Trips' } })
    expect(document.title).toBe('Bunya Support · Trips')

    rerender({ title: 'Participants' })
    expect(document.title).toBe('Bunya Support · Participants')
  })
})
