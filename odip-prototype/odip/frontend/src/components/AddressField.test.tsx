import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AddressField } from './AddressField'
import { resetAddressLookup } from '@/lib/addressLookupState'
import type { AddressParts } from './AddressField'

const { apiPost, apiGet } = vi.hoisted(() => ({ apiPost: vi.fn(), apiGet: vi.fn() }))
vi.mock('@/api/client', () => ({ apiPost, apiGet }))

const rows = [
  { placeId: 'p1', mainText: '12 Example Street', secondaryText: 'Brisbane City QLD' },
  { placeId: 'p2', mainText: '12 Example Road', secondaryText: 'Cairns QLD' },
]
const details = { street: '12 Example Street', suburb: 'Brisbane City', state: 'QLD', postcode: '4000', formattedAddress: '12 Example Street, Brisbane City QLD 4000' }

function Harness({ initial = '', maxLength, wholeLine, onPick = () => {}, onText = () => {} }: { initial?: string; maxLength?: number; wholeLine?: boolean; onPick?: (p: AddressParts) => void; onText?: (t: string) => void }) {
  const [value, setValue] = useState(initial)
  return <AddressField id="street" value={value} maxLength={maxLength} wholeLine={wholeLine} onChange={(t) => { setValue(t); onText(t) }} onPick={onPick} />
}

const input = () => screen.getByRole('combobox')
const type = (text: string) => fireEvent.change(input(), { target: { value: text } })
// Past the debounce, and the awaited answer.
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }

beforeEach(() => {
  vi.useFakeTimers()
  resetAddressLookup()
  apiPost.mockReset().mockResolvedValue(rows)
  apiGet.mockReset().mockResolvedValue(details)
})
afterEach(() => vi.useRealTimers())

describe('AddressField', () => {
  it('is a plain, closed combobox at rest and makes no request', () => {
    render(<Harness />)
    expect(input()).toHaveAttribute('aria-expanded', 'false')
    expect(input()).toHaveAttribute('autocomplete', 'off')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('asks nothing under 3 characters, and every keystroke reaches the caller', async () => {
    const onText = vi.fn()
    render(<Harness onText={onText} />)
    type('12')
    await settle()
    expect(apiPost).not.toHaveBeenCalled()
    expect(onText).toHaveBeenCalledWith('12')
  })

  it('waits for a pause before asking, and asks once for a burst', async () => {
    render(<Harness />)
    type('12 E')
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    type('12 Ex')
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(apiPost).not.toHaveBeenCalled()
    await settle()
    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiPost.mock.calls[0][0]).toBe('/address/suggest')
    expect(apiPost.mock.calls[0][1].q).toBe('12 Ex')
  })

  it('sends a 22-character URL-safe session token, without crypto.randomUUID', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    try {
      render(<Harness />)
      type('12 Example')
      await settle()
      expect(apiPost.mock.calls[0][1].session).toMatch(/^[A-Za-z0-9_-]{22}$/)
    } finally { vi.unstubAllGlobals() }
  })

  it('opens the list when focused and answered, with the Google Maps attribution outside the listbox', async () => {
    render(<Harness />)
    input().focus()
    type('12 Example')
    await settle()
    expect(input()).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox', { name: 'Address suggestions' })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('Brisbane City QLD')).toBeInTheDocument()
    const attribution = screen.getByText('Google Maps')
    expect(list).not.toContainElement(attribution)
    expect(screen.getByRole('status')).toHaveTextContent('2 suggestions')
  })

  it('does not open a list the person has already left', async () => {
    render(<Harness />)
    type('12 Example')   // never focused
    await settle()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('moves the active option with the arrows, without wrapping', async () => {
    render(<Harness />)
    input().focus()
    type('12 Example')
    await settle()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('Escape closes the list, keeps the text and does not reach a surrounding handler', async () => {
    const outer = vi.fn()
    render(<div onKeyDown={outer}><Harness /></div>)
    input().focus()
    type('12 Example')
    await settle()
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input()).toHaveValue('12 Example')
    expect(outer).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'Escape' })   // list already closed: the key goes on to the dialog
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('Enter with no active option does nothing; Down reopens a closed list', async () => {
    render(<Harness />)
    input().focus()
    type('12 Example')
    await settle()
    const notPrevented = fireEvent.keyDown(input(), { key: 'Enter' })
    expect(notPrevented).toBe(true)
    fireEvent.keyDown(input(), { key: 'Escape' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('Enter on the active option fills the street, hands over the parts and keeps focus', async () => {
    const onPick = vi.fn()
    const onText = vi.fn()
    render(<Harness onPick={onPick} onText={onText} />)
    input().focus()
    type('12 Example')
    await settle()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    const prevented = !fireEvent.keyDown(input(), { key: 'Enter' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(prevented).toBe(true)
    expect(apiGet).toHaveBeenCalledWith('/address/details', { placeId: 'p1', session: apiPost.mock.calls[0][1].session })
    expect(input()).toHaveValue('12 Example Street')
    expect(onPick).toHaveBeenCalledWith({ street: '12 Example Street', suburb: 'Brisbane City', state: 'QLD', postcode: '4000', formatted: details.formattedAddress })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(input())
    expect(screen.getByRole('status')).toHaveTextContent('Address filled in.')
  })

  it('a click on a row picks it, and pressing the row does not take focus from the input', async () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    input().focus()
    type('12 Example')
    await settle()
    const pressed = fireEvent.pointerDown(screen.getAllByRole('option')[1])
    expect(pressed).toBe(false)   // default prevented
    fireEvent.click(screen.getAllByRole('option')[1])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(apiGet.mock.calls[0][1].placeId).toBe('p2')
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('the next typing after a pick starts a new session and is not re-queried by the pick itself', async () => {
    render(<Harness />)
    input().focus()
    type('12 Example')
    await settle()
    const first = apiPost.mock.calls[0][1].session
    fireEvent.click(screen.getAllByRole('option')[0])
    await settle()
    expect(apiPost).toHaveBeenCalledTimes(1)
    type('12 Example Street 5')
    await settle()
    expect(apiPost).toHaveBeenCalledTimes(2)
    expect(apiPost.mock.calls[1][1].session).not.toBe(first)
  })

  it('cuts the picked street to maxLength', async () => {
    render(<Harness maxLength={8} />)
    input().focus()
    type('12 Exam')
    await settle()
    fireEvent.click(screen.getAllByRole('option')[0])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(input()).toHaveValue('12 Examp')
  })

  it('typing while details load is not overwritten, and nothing is handed over', async () => {
    let resolveDetails: (v: unknown) => void = () => {}
    apiGet.mockImplementationOnce(() => new Promise((r) => { resolveDetails = r }))
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    input().focus()
    type('12 Example')
    await settle()
    fireEvent.click(screen.getAllByRole('option')[0])
    type('12 Example Street, Unit 4')
    await act(async () => { resolveDetails(details) })
    expect(input()).toHaveValue('12 Example Street, Unit 4')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a failed details call puts the prediction text in and fills nothing else, silently', async () => {
    apiGet.mockRejectedValue(new Error('502'))
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    input().focus()
    type('12 Example')
    await settle()
    fireEvent.click(screen.getAllByRole('option')[0])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(input()).toHaveValue('12 Example Street')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a failed details call on a whole-line field puts the main and secondary text of the prediction in; a street field keeps the main text', async () => {
    apiGet.mockRejectedValue(new Error('502'))
    const onText = vi.fn()
    const { unmount } = render(<Harness wholeLine onText={onText} />)
    input().focus()
    type('12 Example')
    await settle()
    fireEvent.click(screen.getAllByRole('option')[0])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(input()).toHaveValue('12 Example Street, Brisbane City QLD')
    expect(onText).toHaveBeenLastCalledWith('12 Example Street, Brisbane City QLD')
    unmount()
    render(<Harness />)
    input().focus()
    type('12 Example')
    await settle()
    fireEvent.click(screen.getAllByRole('option')[0])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(input()).toHaveValue('12 Example Street')
  })

  it('editing after a pick is plain typing', async () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    input().focus()
    type('12 Example')
    await settle()
    fireEvent.click(screen.getAllByRole('option')[0])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    type('12 Example Street, Unit 4')
    expect(input()).toHaveValue('12 Example Street, Unit 4')
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('says so when nothing matches, and invites typing it in', async () => {
    apiPost.mockResolvedValue([])
    render(<Harness />)
    input().focus()
    type('zzzzzz')
    await settle()
    expect(screen.getByText('No matching address. Keep typing, or enter it yourself.')).toBeInTheDocument()
    expect(screen.queryByText('Google Maps')).toBeNull()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('No matching address')
  })

  it('a 404 (no key) turns the field into a plain input and makes no further request, even in a new field', async () => {
    apiPost.mockRejectedValue({ response: { status: 404 } })
    const { unmount } = render(<Harness />)
    input().focus()
    type('12 Example')
    await settle()
    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    unmount()

    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '99 Another Street' } })
    await settle()
    expect(apiPost).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['500', { response: { status: 500 } }],
    ['429', { response: { status: 429 } }],
    ['network', new Error('Network Error')],
  ])('a %s answer is silent: no list, no toast, typing carries on and the next try is made', async (_name, failure) => {
    apiPost.mockRejectedValueOnce(failure)
    const onText = vi.fn()
    render(<Harness onText={onText} />)
    input().focus()
    type('12 Example')
    await settle()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input()).toHaveAttribute('aria-expanded', 'false')
    type('12 Example S')
    await settle()
    expect(apiPost).toHaveBeenCalledTimes(2)
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('drops a slow answer for text that has changed', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    apiPost.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
    render(<Harness />)
    input().focus()
    type('12 Example')
    await settle()   // first request in flight
    type('12 Example S')
    await act(async () => { resolveFirst([{ placeId: 'old', mainText: 'Old', secondaryText: '' }]) })
    expect(screen.queryByText('Old')).toBeNull()
  })

  it('cuts a long answer to 5 rows', async () => {
    apiPost.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ placeId: `p${i}`, mainText: `Row ${i}`, secondaryText: '' })))
    render(<Harness />)
    input().focus()
    type('12 Example')
    await settle()
    expect(screen.getAllByRole('option')).toHaveLength(5)
  })

  it('Tab and blur close the list', async () => {
    render(<Harness />)
    input().focus()
    type('12 Example')
    await settle()
    fireEvent.keyDown(input(), { key: 'Tab' })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.blur(input())
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
