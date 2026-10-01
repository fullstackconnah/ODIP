import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

/**
 * L5-07: navigator.clipboard exists only in a secure context (https or localhost). This app is also served over plain http on the LAN, where it
 * is undefined, so a bare navigator.clipboard.writeText(...) threw an uncaught TypeError. copyText tries the async clipboard first and falls back
 * to a selection copy (a temporary, off-screen textarea and execCommand('copy')), and says whether either worked.
 */
const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original)
  else delete (navigator as unknown as Record<string, unknown>).clipboard
  vi.restoreAllMocks()
})

describe('copyText', () => {
  it('uses the async clipboard when there is one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    document.execCommand = vi.fn(() => true)

    await expect(copyText('https://odip.example/caregiver/abc')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('https://odip.example/caregiver/abc')
    expect(document.execCommand).not.toHaveBeenCalled()
  })

  it('falls back to a selection copy when navigator.clipboard is undefined (plain http), and leaves no element behind', async () => {
    setClipboard(undefined)
    let copied: string | undefined
    document.execCommand = vi.fn((command: string) => {
      if (command === 'copy') copied = (document.activeElement as HTMLTextAreaElement | null)?.value
      return true
    })

    await expect(copyText('https://odip.example/caregiver/abc')).resolves.toBe(true)

    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(copied).toBe('https://odip.example/caregiver/abc')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('falls back when the async clipboard rejects (permission denied)', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) })
    document.execCommand = vi.fn(() => true)

    await expect(copyText('x')).resolves.toBe(true)

    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('says false, and never throws, when nothing can copy', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn(() => false)

    await expect(copyText('x')).resolves.toBe(false)

    document.execCommand = vi.fn(() => { throw new Error('not supported') })
    await expect(copyText('x')).resolves.toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })
})
