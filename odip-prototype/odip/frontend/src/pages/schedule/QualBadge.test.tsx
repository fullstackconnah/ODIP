import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Car, Shield, Pill, HandMetal, Moon } from 'lucide-react'
import { QualBadgeList, type Qualification } from './QualBadge'

const ALL: Qualification[] = [
  { active: true, icon: Car, title: 'Driver Eligible' },
  { active: true, icon: Shield, title: 'First Aid' },
  { active: true, icon: Pill, title: 'Medication' },
  { active: true, icon: HandMetal, title: 'Manual Handling' },
  { active: true, icon: Moon, title: 'Overnight' },
]

describe('QualBadgeList', () => {
  it('shows every active qualification as its own chip when they fit on the line', () => {
    render(<QualBadgeList items={ALL.slice(0, 4)} />)

    for (const q of ALL.slice(0, 4)) expect(screen.getByTitle(q.title)).toBeInTheDocument()
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument()
  })

  it('collapses the overflow into a "+N" chip carrying the FULL list in its title', () => {
    const { container } = render(<QualBadgeList items={ALL} />)

    // Four slots: three chips plus "+2".
    expect(screen.getByTitle('Driver Eligible')).toBeInTheDocument()
    expect(screen.getByTitle('First Aid')).toBeInTheDocument()
    expect(screen.getByTitle('Medication')).toBeInTheDocument()
    expect(screen.queryByTitle('Manual Handling')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Overnight')).not.toBeInTheDocument()

    const more = screen.getByText('+2')
    expect(more.closest('[title]')).toHaveAttribute('title', 'Driver Eligible, First Aid, Medication, Manual Handling, Overnight')
    // Screen readers get the same list, not just a bare number — from the chip's label, not a visually-hidden
    // span (a 1px clip box whose text overflows it reads as "clipped without an ellipsis").
    expect(more.closest('[title]')).toHaveAccessibleName('+2 more qualifications: Driver Eligible, First Aid, Medication, Manual Handling, Overnight')
    expect(container.querySelector('.sr-only')).toBeNull()
  })

  it('skips inactive qualifications when counting', () => {
    const items = ALL.map((q, i) => ({ ...q, active: i !== 1 && i !== 3 }))
    render(<QualBadgeList items={items} />)

    expect(screen.getByTitle('Driver Eligible')).toBeInTheDocument()
    expect(screen.getByTitle('Medication')).toBeInTheDocument()
    expect(screen.getByTitle('Overnight')).toBeInTheDocument()
    expect(screen.queryByTitle('First Aid')).not.toBeInTheDocument()
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument()
  })

  it('renders nothing when no qualification applies', () => {
    const { container } = render(<QualBadgeList items={ALL.map(q => ({ ...q, active: false }))} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps every chip at 20px (h-5), the ceiling for a chip inside a 34px row', () => {
    render(<QualBadgeList items={ALL} />)
    expect(screen.getByTitle('Driver Eligible')).toHaveClass('h-5', 'w-5')
    expect(screen.getByText('+2').closest('[title]')).toHaveClass('h-5')
  })
})
