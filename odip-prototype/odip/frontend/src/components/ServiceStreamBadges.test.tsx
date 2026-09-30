import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ServiceStreamBadges } from './ServiceStreamBadges'

describe('ServiceStreamBadges', () => {
  it('renders one chip per stream, with the full expansion as its title', () => {
    render(<ServiceStreamBadges value="STA, InHomeSupport" />)

    expect(screen.getByText('STA')).toHaveAttribute('title', 'Short Term Accommodation')
    expect(screen.getByText('In-Home Support')).toBeInTheDocument()
  })

  it.each([
    ['"None"', 'None'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['only unknown stream names', 'NotAStream'],
  ])('renders nothing (not a dash) when the value is %s, so a meta row never ends in a dangling "—"', (_label, value) => {
    const { container } = render(<ServiceStreamBadges value={value} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})
