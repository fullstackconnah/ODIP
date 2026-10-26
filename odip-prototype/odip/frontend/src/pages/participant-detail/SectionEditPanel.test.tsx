import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
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

// A refused save (409 participant-section-changed): the draft stays, Latest saved appears beside it, and Save retries on the refetched revision.
const TITLE = 'Someone else saved this section since you opened it.'
const BODY = 'Compare what you typed with Latest saved, then save to replace their version, or cancel to keep it.'
const LOADING = 'Loading the latest saved version…'
const refusal = (aboutMe: number) => Object.assign(new Error('409'), {
  response: { status: 409, data: { success: false, code: 'participant-section-changed', errors: [TITLE], data: { groupRevisions: { aboutMe } } } },
})
const GROUPS = ['aboutMe'] as const
type Save = (expected: Partial<Record<'aboutMe', number>>) => Promise<void>

function Refusable({ onSave, aboutMe, groups = GROUPS }: { onSave: Save; aboutMe?: number; groups?: readonly 'aboutMe'[] }) {
  const [text, setText] = useState('')
  return (
    <SectionEditPanel title="Card" canEdit isDirty={text !== ''} groups={groups} revisions={aboutMe === undefined ? undefined : { aboutMe }}
      onEditStart={() => {}} onCancel={() => setText('')} onSave={onSave}>
      {(editing) => editing ? <input aria-label="goals" value={text} onChange={e => setText(e.target.value)} /> : <p>read view</p>}
    </SectionEditPanel>
  )
}

const saveBtn = () => screen.getByRole('button', { name: 'Save' })
const callout = () => document.querySelector<HTMLElement>('[data-save-refused-callout]')
const latest = () => document.querySelector<HTMLElement>('[data-latest-saved]')
const srStatus = () => screen.getAllByRole('status').find(n => n.className.includes('sr-only'))!

async function openAndSave(text = 'mine') {
  await userEvent.click(screen.getByRole('button', { name: /Edit/ }))
  await userEvent.type(screen.getByLabelText('goals'), text)
  await userEvent.click(saveBtn())
}

describe('SectionEditPanel refused save', () => {
  it('F0 the status live region exists before a refusal', async () => {
    render(<Refusable onSave={vi.fn().mockRejectedValue(refusal(4))} aboutMe={3} />)
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }))
    const status = srStatus()
    expect(status).toHaveTextContent('')
    await userEvent.type(screen.getByLabelText('goals'), 'mine')
    await userEvent.click(saveBtn())
    expect(srStatus()).toBe(status)
    expect(status).toHaveTextContent(LOADING)
  })

  it('F1 snapshots revisions at edit start', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<Refusable onSave={onSave} aboutMe={3} />)
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }))
    rerender(<Refusable onSave={onSave} aboutMe={5} />)
    await userEvent.click(saveBtn())
    expect(onSave).toHaveBeenCalledWith({ aboutMe: 3 })
  })

  it('F2 refusal keeps the draft and shows the refused state', async () => {
    render(<Refusable onSave={vi.fn().mockRejectedValue(refusal(4))} aboutMe={3} />)
    await openAndSave()
    expect(screen.getByLabelText('goals')).toHaveValue('mine')
    expect(callout()).toHaveTextContent(TITLE)
    expect(callout()).toHaveTextContent(BODY)
    expect(callout()).toHaveFocus()
    expect(screen.queryByText('Failed to save changes.')).toBeNull()
    expect(latest()).toHaveTextContent(LOADING)
    expect(latest()).not.toHaveTextContent('read view')
    expect(srStatus()).toHaveTextContent(LOADING)
  })

  it('F3 retry after the refetch sends the refetched revision', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(refusal(4)).mockResolvedValue(undefined)
    const { rerender } = render(<Refusable onSave={onSave} aboutMe={3} />)
    await openAndSave()
    rerender(<Refusable onSave={onSave} aboutMe={4} />)
    expect(latest()).toHaveTextContent('read view')
    await userEvent.click(saveBtn())
    expect(onSave).toHaveBeenLastCalledWith({ aboutMe: 4 })
    expect(document.querySelector('[data-save-refused]')).toBeNull()
    expect(screen.queryByLabelText('goals')).toBeNull()
  })

  it('F3b before the refetch it does not adopt', async () => {
    const onSave = vi.fn().mockRejectedValue(refusal(4))
    render(<Refusable onSave={onSave} aboutMe={3} />)
    await openAndSave()
    await userEvent.click(saveBtn())
    expect(onSave).toHaveBeenLastCalledWith({ aboutMe: 3 })
  })

  it('F4 cancel clears the refused state and the status text', async () => {
    render(<Refusable onSave={vi.fn().mockRejectedValue(refusal(4))} aboutMe={3} />)
    await openAndSave()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(callout()).toBeNull()
    expect(latest()).toBeNull()
    expect(screen.getByText('read view')).toBeInTheDocument()
    expect(screen.queryByText(LOADING)).toBeNull()
  })

  it('F4b a successful retry clears the status text', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(refusal(4)).mockResolvedValue(undefined)
    render(<Refusable onSave={onSave} aboutMe={3} />)
    await openAndSave()
    await userEvent.click(saveBtn())
    expect(screen.queryByText(LOADING)).toBeNull()
    expect(screen.queryByText('Latest saved version shown.')).toBeNull()
  })

  it('F5 no groups sends an empty expected', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Refusable onSave={onSave} groups={[]} />)
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }))
    await userEvent.click(saveBtn())
    expect(onSave).toHaveBeenCalledWith({})
  })

  it('F6 a second refusal re-announces', async () => {
    render(<Refusable onSave={vi.fn().mockRejectedValue(refusal(4))} aboutMe={3} />)
    await openAndSave()
    const first = callout()
    screen.getByLabelText('goals').focus()
    await userEvent.click(saveBtn())
    expect(callout()).not.toBe(first)
    expect(callout()).toHaveFocus()
  })

  it('F7 other errors use the error callout and keep Latest saved', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(refusal(4)).mockRejectedValue(new Error('Server broke.'))
    const { rerender } = render(<Refusable onSave={onSave} aboutMe={3} />)
    await openAndSave()
    rerender(<Refusable onSave={onSave} aboutMe={4} />)
    await userEvent.click(saveBtn())
    expect(screen.getByText('Server broke.')).toBeInTheDocument()
    expect(latest()).not.toBeNull()
    expect(callout()).toBeNull()
  })
})
