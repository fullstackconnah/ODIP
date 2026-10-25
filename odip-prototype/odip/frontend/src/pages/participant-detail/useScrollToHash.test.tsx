import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useScrollToHash } from './participantTabs'

function Harness({ folded }: { folded: boolean }) {
  useScrollToHash('p-1')
  const heading = <h3>Health conditions</h3>
  return (
    <section id="health-conditions">
      {folded ? <details><summary>Not recorded: Health conditions</summary><div>{heading}</div></details> : heading}
    </section>
  )
}

const renderAt = (folded: boolean) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/participants/p-1#health-conditions']}><Harness folded={folded} /></MemoryRouter>
  </QueryClientProvider>,
)

describe('useScrollToHash focus', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })

  it('focuses the visible heading of a section', async () => {
    renderAt(false)
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('h3')))
  })

  it('focuses the section itself when its only heading sits in a closed fold', async () => {
    renderAt(true)
    const section = document.getElementById('health-conditions')!
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    expect(document.activeElement).toBe(section)
    expect(document.activeElement?.closest('details:not([open])')).toBeNull()
  })
})
