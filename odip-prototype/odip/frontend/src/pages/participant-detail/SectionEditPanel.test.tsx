import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SectionEditPanel } from './SectionEditPanel'

function Panel({ addFirst }: { addFirst?: boolean }) {
  return (
    <SectionEditPanel title="Card" canEdit isDirty={false} onEditStart={() => {}} onCancel={() => {}} onSave={async () => {}}>
      {(editing, startEdit) => editing ? (
        <div>
          <input aria-label="one" defaultValue="filled" />
          <input aria-label="two" defaultValue="" />
          <input aria-label="three" defaultValue="" />
        </div>
      ) : (
        addFirst ? <button onClick={() => startEdit('first-empty')}>Add</button> : <p>read</p>
      )}
    </SectionEditPanel>
  )
}

describe("SectionEditPanel startEdit('first-empty')", () => {
  it('opens edit and focuses the first empty field', async () => {
    render(<Panel addFirst />)
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByLabelText('two')).toHaveFocus()
  })

  it('leaves focus alone when the plain Edit button opens it', async () => {
    render(<Panel />)
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }))
    expect(screen.getByLabelText('two')).not.toHaveFocus()
  })
})
