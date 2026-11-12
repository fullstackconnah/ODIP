import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { noBreakRefs } from './noBreakRef'

describe('noBreakRefs', () => {
  it('wraps claim and invoice references in no-wrap spans and leaves the text as typed', () => {
    const text = 'Void INV-0042 first, then delete TC-20261022-0003. Re-check the follow-up.'
    const { container } = render(<p>{noBreakRefs(text)}</p>)
    const spans = [...container.querySelectorAll('span.whitespace-nowrap')].map(s => s.textContent)
    expect(spans).toEqual(['INV-0042', 'TC-20261022-0003'])
    expect(container.textContent).toBe(text)
  })

  const spansOf = (text: string) => {
    const { container } = render(<p>{noBreakRefs(text)}</p>)
    return { spans: [...container.querySelectorAll('span.whitespace-nowrap')].map(s => s.textContent), text: container.textContent }
  }

  it('keeps one time range on one line', () => {
    const text = 'Extra time 02:30–02:30 (clocks went back) · 60 min'
    expect(spansOf(text)).toEqual({ spans: ['02:30–02:30'], text })
  })

  it('wraps each range alone, so the line can still wrap between ranges', () => {
    const text = 'Extra time 08:40–09:00, 17:00–17:20 · 40 min'
    expect(spansOf(text)).toEqual({ spans: ['08:40–09:00', '17:00–17:20'], text })
  })

  it('wraps a reference and a range in the same text', () => {
    const text = 'INV-0042 covers 09:00–10:30'
    expect(spansOf(text)).toEqual({ spans: ['INV-0042', '09:00–10:30'], text })
  })
})
