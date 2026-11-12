import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { IncidentDetailDto } from '@/api/types/incidents'
import { RpCard } from './IncidentViewCards'

const edit = { canEdit: false, busy: false, onEdit: () => {} }
const show = (over: Partial<IncidentDetailDto>) => render(<MemoryRouter><RpCard incident={{ restrictivePracticeType: null, ...over } as IncidentDetailDto} edit={edit} /></MemoryRouter>)

describe('RpCard Type row', () => {
  it('keeps the Type row with the house muted dash, not "Not recorded", when no type is set', () => {
    show({})
    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()
    const dd = screen.getByText('Type').nextElementSibling!
    expect(dd).toHaveTextContent('—')
  })
  it('shows the type label when one is set', () => {
    show({ restrictivePracticeType: 'Seclusion' } as Partial<IncidentDetailDto>)
    expect(screen.getByText('Seclusion')).toBeInTheDocument()
  })
})
