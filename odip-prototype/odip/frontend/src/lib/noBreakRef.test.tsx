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
})
