import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { RequirementChips } from './RequirementChips'

describe('RequirementChips', () => {
  it('draws one chip for each thing the agreement asks of a worker', () => {
    render(<RequirementChips requirements={{ workerGender: 'Female', driver: true, skills: ['FirstAid', 'ManualHandling'] }} />)

    const list = screen.getByRole('list', { name: 'Asks for' })
    expect(within(list).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Female worker', 'Driver', 'First aid', 'Manual handling'])
  })

  it('says it is information: the roster does not check it against the worker yet', () => {
    render(<RequirementChips requirements={{ workerGender: 'Male', driver: false, skills: [] }} />)

    expect(screen.getByText('Male worker')).toHaveAttribute('title', 'Asked for by the agreement. Not checked against the worker yet.')
  })

  it('draws nothing when nothing is asked, so a row never ends in an empty strip', () => {
    const { container, rerender } = render(<RequirementChips requirements={{ workerGender: 'NoPreference', driver: false, skills: [] }} />)
    expect(container).toBeEmptyDOMElement()

    rerender(<RequirementChips requirements={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
