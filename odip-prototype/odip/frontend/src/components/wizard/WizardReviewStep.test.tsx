import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WizardReviewStep } from './WizardReviewStep'
import type { ReviewGroup, WizardStepDef } from './types'

type V = { firstName: string }

const steps: WizardStepDef<V>[] = [{ key: 'identity', label: 'Identity', fields: ['firstName'] }]
const groups: ReviewGroup[] = [
  { stepKey: 'identity', rows: [{ label: 'First Name', value: 'Jamie' }] },
]

describe('WizardReviewStep', () => {
  it('renders one Card per group, titled from the owning step, with a default <dl> row', () => {
    render(<WizardReviewStep groups={groups} steps={steps} onEdit={vi.fn()} />)
    expect(screen.getByText('Identity')).toBeInTheDocument()
    expect(screen.getByText('First Name')).toBeInTheDocument()
    expect(screen.getByText('Jamie')).toBeInTheDocument()
  })

  it('calls onEdit with the group\'s stepKey when its Edit button is clicked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<WizardReviewStep groups={groups} steps={steps} onEdit={onEdit} />)
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }))
    expect(onEdit).toHaveBeenCalledWith('identity')
  })

  it('lets a consumer override row rendering without owning the surrounding chrome', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(
      <WizardReviewStep
        groups={groups}
        steps={steps}
        onEdit={onEdit}
        renderRow={(row) => <div key={row.label} data-testid="custom-row">{row.label}: {row.value}</div>}
      />,
    )
    expect(screen.getByTestId('custom-row')).toHaveTextContent('First Name: Jamie')
    // The Card/Edit-link chrome is still the shell's — an overridden row renderer doesn't
    // remove it.
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }))
    expect(onEdit).toHaveBeenCalledWith('identity')
  })
})
