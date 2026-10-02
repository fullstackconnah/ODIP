import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useToast, TOAST_SUCCESS_MS } from './useToast'

function Harness() {
  const { toast, notify } = useToast()
  return (
    <>
      <button onClick={() => notify('success', 'Saved it')}>say success</button>
      <button onClick={() => notify('error', 'Could not do it')}>say error</button>
      {toast}
    </>
  )
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useToast', () => {
  it('renders nothing until something is said', () => {
    render(<Harness />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says a success politely (role=status) and clears it by itself once TOAST_SUCCESS_MS has passed', () => {
    render(<Harness />)
    press('say success')
    expect(screen.getByRole('status')).toHaveTextContent('Saved it')

    wait(TOAST_SUCCESS_MS - 1)
    expect(screen.getByRole('status')).toBeInTheDocument()
    wait(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says an error assertively (role=alert) and keeps it until it is dismissed', () => {
    render(<Harness />)
    press('say error')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not do it')

    wait(TOAST_SUCCESS_MS * 10)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    press('Dismiss notification')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a success can be dismissed before its time is up', () => {
    render(<Harness />)
    press('say success')
    press('Dismiss notification')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('a newer message replaces the one showing and restarts the clock', () => {
    render(<Harness />)
    press('say success')
    wait(TOAST_SUCCESS_MS - 1000)
    press('say success')

    wait(TOAST_SUCCESS_MS - 1)
    expect(screen.getByRole('status')).toBeInTheDocument()
    wait(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('an error that replaces a success is not taken away by the success timer still running', () => {
    render(<Harness />)
    press('say success')
    wait(TOAST_SUCCESS_MS - 1000)
    press('say error')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    wait(TOAST_SUCCESS_MS)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not do it')
  })
})
