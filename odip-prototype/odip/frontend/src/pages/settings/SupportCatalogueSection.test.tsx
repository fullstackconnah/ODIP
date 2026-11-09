import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import SupportCatalogueSection from './SupportCatalogueSection'

vi.mock('@/api/hooks', () => ({ useSupportCatalogue: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }) }))

const TOO_BIG = 'This file is over 10 MB. Choose the NDIS Support Catalogue .xlsx file.'
const MB10 = 10 * 1024 * 1024

async function openImport() {
  render(<QueryClientProvider client={new QueryClient()}><SupportCatalogueSection /></QueryClientProvider>)
  await userEvent.click(screen.getByRole('button', { name: /import catalogue/i }))
  return document.querySelector('input[type=file]') as HTMLInputElement
}
const fileOf = (size: number) => {
  const f = new File(['x'], 'catalogue.xlsx')
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const mockPost = vi.fn()
beforeEach(() => {
  mockPost.mockReset()
  apiClient.defaults.adapter = async config => mockPost(config)
})
afterEach(cleanup)

describe('SupportCatalogueSection import size', () => {
  it('refuses a file over 10 MB before upload and clears the picker', async () => {
    const input = await openImport()
    fireEvent.change(input, { target: { files: [fileOf(MB10 + 1)] } })
    const note = await screen.findByText(TOO_BIG)
    expect(note.textContent).toContain('.xlsx\u00a0file.') // no-break, so "file." never wraps alone
    expect(mockPost).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })

  it('names the catalogue the way the NDIA publishes it in the upload hint', async () => {
    await openImport()
    expect(screen.getByText('Upload the NDIS Support Catalogue .xlsx file to preview changes.')).toBeInTheDocument()
  })

  it('uploads a file of exactly 10 MB', async () => {
    mockPost.mockResolvedValue({ data: { data: { rows: [], warnings: [], detectedVersion: 'v1' } }, status: 200, statusText: 'OK', headers: {}, config: {} })
    const input = await openImport()
    fireEvent.change(input, { target: { files: [fileOf(MB10)] } })
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(TOO_BIG)).not.toBeInTheDocument()
  })

  it('shows the same message when the server answers 413', async () => {
    mockPost.mockImplementation(async () => { throw Object.assign(new Error('Request failed with status code 413'), { isAxiosError: true, response: { status: 413, data: {} } }) })
    const input = await openImport()
    fireEvent.change(input, { target: { files: [fileOf(1024)] } })
    expect(await screen.findByText(TOO_BIG)).toBeInTheDocument()
  })
})
