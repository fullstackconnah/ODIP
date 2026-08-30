import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchableSelect } from './SearchableSelect'
import type { SearchableSelectItem } from './SearchableSelect'

/** A real controlled parent — round-trips onChange back into `value`, the way every actual
 * consumer does. Used wherever a test needs to see the closed-state display text settle onto a
 * freshly-selected item, since that text is derived straight from the `value` prop rather than
 * cached locally. */
function Controlled({ items, initial }: { items: SearchableSelectItem[]; initial: string }) {
  const [value, setValue] = useState(initial)
  return <SearchableSelect items={items} value={value} onChange={setValue} />
}

const items = [
  { value: 'a', label: 'Alex Rivera' },
  { value: 'b', label: 'Bianca Novak' },
  { value: 'c', label: 'Casey Wong' },
  { value: 'd', label: 'Dana Ahmed', disabled: true },
]

describe('SearchableSelect — combobox contract', () => {
  it('renders a text input with role=combobox and the collapsed-state aria wiring', () => {
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    const combobox = screen.getByRole('combobox')
    expect(combobox).toHaveAttribute('aria-expanded', 'false')
    expect(combobox).toHaveAttribute('aria-autocomplete', 'list')
    expect(combobox).toHaveAttribute('aria-controls')
    expect(combobox).not.toHaveAttribute('aria-activedescendant')
  })

  it("shows the selected item's label as the input's value when closed", () => {
    render(<SearchableSelect items={items} value="b" onChange={vi.fn()} />)

    expect(screen.getByRole('combobox')).toHaveValue('Bianca Novak')
  })

  it('shows a blank input when the value matches no item', () => {
    render(<SearchableSelect items={items} value="nonexistent" onChange={vi.fn()} />)

    expect(screen.getByRole('combobox')).toHaveValue('')
  })
})

describe('SearchableSelect — opening and filtering', () => {
  it('opens the full unfiltered option list on focus, before any typing', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(4)
    expect(options.map(o => o.textContent)).toEqual(['Alex Rivera', 'Bianca Novak', 'Casey Wong', 'Dana Ahmed'])
  })

  it('narrows the list to items whose label contains the typed text, case-insensitively', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))
    await user.type(screen.getByRole('combobox'), 'bian')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Bianca Novak')
  })

  it('shows a "no results" message when the query matches nothing', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))
    await user.type(screen.getByRole('combobox'), 'zzz')

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No results found')).toBeInTheDocument()
  })

  it('shows the empty-options message when there are no items to search at all', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={[]} value="" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByText('No options available')).toBeInTheDocument()
  })

  it('supports custom empty/no-match messages', async () => {
    const user = userEvent.setup()
    render(
      <SearchableSelect
        items={[]}
        value=""
        onChange={vi.fn()}
        emptyMessage="No staff to choose from"
        noMatchMessage="Nobody matches that"
      />,
    )

    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('No staff to choose from')).toBeInTheDocument()
  })

  it('clearing the typed query back to empty restores the full list', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.type(combobox, 'bian')
    expect(screen.getAllByRole('option')).toHaveLength(1)

    await user.clear(combobox)
    expect(screen.getAllByRole('option')).toHaveLength(4)
  })
})

describe('SearchableSelect — loading state', () => {
  it('shows a loading row instead of the empty message while options are still arriving', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={[]} value="" onChange={vi.fn()} loading />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByText('Loading options…')).toBeInTheDocument()
    expect(screen.queryByText('No options available')).not.toBeInTheDocument()
  })

  it('still allows typing while loading (the field itself is not disabled)', () => {
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} loading />)

    expect(screen.getByRole('combobox')).not.toBeDisabled()
  })
})

describe('SearchableSelect — selection', () => {
  it('calls onChange and closes the popup when an option is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableSelect items={items} value="" onChange={onChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Casey Wong' }))

    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })

  it("settles the closed-state display text onto the newly-selected item's label, once the controlling parent round-trips the new value back in", async () => {
    const user = userEvent.setup()
    render(<Controlled items={items} initial="" />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Casey Wong' }))

    expect(screen.getByRole('combobox')).toHaveValue('Casey Wong')
  })

  it('does not select a disabled option on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableSelect items={items} value="" onChange={onChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Dana Ahmed' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('calls onBlur when selecting an option', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} onBlur={onBlur} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Casey Wong' }))

    expect(onBlur).toHaveBeenCalled()
  })

  it('keeps DOM focus on the input after a mouse click commits a selection (mousedown-blur guard)', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.click(screen.getByRole('option', { name: 'Casey Wong' }))

    expect(document.activeElement).toBe(combobox)
  })
})

describe('SearchableSelect — keyboard support', () => {
  it('ArrowDown from a closed popup opens it', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    // focusing already opens it (matches focus-opens-popup behaviour); re-close via Escape first.
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
  })

  it('ArrowDown moves aria-activedescendant to the next enabled option, skipping disabled ones', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.keyboard('{ArrowDown}')
    let activeId = combobox.getAttribute('aria-activedescendant')
    expect(document.getElementById(activeId!)).toHaveTextContent('Alex Rivera')

    await user.keyboard('{ArrowDown}{ArrowDown}')
    activeId = combobox.getAttribute('aria-activedescendant')
    expect(document.getElementById(activeId!)).toHaveTextContent('Casey Wong')

    // One more ArrowDown wraps past the disabled last item back to the first.
    await user.keyboard('{ArrowDown}')
    activeId = combobox.getAttribute('aria-activedescendant')
    expect(document.getElementById(activeId!)).toHaveTextContent('Alex Rivera')
  })

  it('ArrowUp wraps to the last enabled option from the top', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.keyboard('{ArrowUp}')

    const activeId = combobox.getAttribute('aria-activedescendant')
    expect(document.getElementById(activeId!)).toHaveTextContent('Casey Wong')
  })

  it('Home jumps to the first enabled option, End jumps to the last enabled option', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} />)

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    await user.keyboard('{End}')
    expect(document.getElementById(combobox.getAttribute('aria-activedescendant')!)).toHaveTextContent('Casey Wong')

    await user.keyboard('{Home}')
    expect(document.getElementById(combobox.getAttribute('aria-activedescendant')!)).toHaveTextContent('Alex Rivera')
  })

  it('Enter selects the active option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableSelect items={items} value="" onChange={onChange} />)

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('c')
    expect(combobox).toHaveAttribute('aria-expanded', 'false')
  })

  it('Enter with no active option but exactly one filtered match selects that match', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableSelect items={items} value="" onChange={onChange} />)

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.type(combobox, 'bianca')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('Escape closes the popup and reverts a typed query back to the selected label, without calling onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableSelect items={items} value="a" onChange={onChange} />)

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.clear(combobox)
    await user.type(combobox, 'zzz')
    expect(combobox).toHaveValue('zzz')

    await user.keyboard('{Escape}')

    expect(combobox).toHaveAttribute('aria-expanded', 'false')
    expect(combobox).toHaveValue('Alex Rivera')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SearchableSelect — outside interaction', () => {
  it('closes and calls onBlur on an outside click, reverting an unsubmitted query', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    const onChange = vi.fn()
    render(
      <div>
        <SearchableSelect items={items} value="a" onChange={onChange} onBlur={onBlur} />
        <button type="button">outside</button>
      </div>,
    )

    const combobox = screen.getByRole('combobox')
    await user.click(combobox)
    await user.clear(combobox)
    await user.type(combobox, 'zzz')

    await user.click(screen.getByRole('button', { name: 'outside' }))

    expect(combobox).toHaveAttribute('aria-expanded', 'false')
    expect(combobox).toHaveValue('Alex Rivera')
    expect(onBlur).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SearchableSelect — disabled', () => {
  it('renders a disabled input that does not open on click', async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={items} value="" onChange={vi.fn()} disabled />)

    const combobox = screen.getByRole('combobox')
    expect(combobox).toBeDisabled()
    await user.click(combobox)
    expect(combobox).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('SearchableSelect — FormField integration', () => {
  it('wires id/aria-labelledby from a wrapping FormField the same way Dropdown does', async () => {
    const { FormField } = await import('./FormField')
    render(
      <FormField label="Staff">
        <SearchableSelect items={items} value="" onChange={vi.fn()} />
      </FormField>,
    )

    const field = screen.getByRole('combobox', { name: 'Staff' })
    expect(field).toBeInTheDocument()
  })
})
