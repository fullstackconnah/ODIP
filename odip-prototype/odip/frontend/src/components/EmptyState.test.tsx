import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Users } from 'lucide-react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders secondaryAction as a second link beside the first', () => {
    render(
      <MemoryRouter>
        <EmptyState icon={Users} title="None" action={{ label: 'Import', to: '/import' }} secondaryAction={{ label: 'Add one', to: '/new' }} />
      </MemoryRouter>,
    )
    expect(screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Import', '/import'], ['Add one', '/new']])
  })
})
