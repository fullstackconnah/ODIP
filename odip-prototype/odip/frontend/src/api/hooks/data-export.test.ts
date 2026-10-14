import { describe, expect, it } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { exportFailure, exportFileName, isWholeZip } from './data-export'
import { localIsoDate } from '@/lib/dateOnly'

const answered = (status: number, data: unknown) =>
  new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, { status, statusText: '', data, headers: {}, config: { headers: new AxiosHeaders() } } as AxiosResponse)
const blobOf = (body: unknown) => new Blob([JSON.stringify(body)], { type: 'application/json' })

describe('exportFileName', () => {
  it("uses the server's name, quoted or not, and otherwise one with today's date", () => {
    expect(exportFileName('attachment; filename="odip-export-sunrise-care-2026-10-14.zip"')).toBe('odip-export-sunrise-care-2026-10-14.zip')
    expect(exportFileName('attachment; filename=odip-export-sunrise-care-2026-10-14.zip')).toBe('odip-export-sunrise-care-2026-10-14.zip')
    expect(exportFileName(undefined)).toBe(`odip-export-${localIsoDate()}.zip`)
  })
})

describe('exportFailure', () => {
  it('a stream that broke, with no response, did not finish and saved nothing', async () => {
    expect(await exportFailure(new AxiosError('Network Error', 'ERR_NETWORK'))).toEqual({
      title: "The export didn't finish",
      body: 'The download stopped before the file was complete, so nothing was saved. Try again.',
    })
  })

  it("a 400 reads the server's sentence out of the Blob body", async () => {
    expect(await exportFailure(answered(400, blobOf({ success: false, errors: ['Choose an organisation to view as before exporting data.'] })))).toEqual({
      title: 'Choose an organisation first',
      body: 'Choose an organisation to view as before exporting data.',
    })
  })

  it('a 400 whose body is not JSON still says what to do', async () => {
    expect(await exportFailure(answered(400, new Blob(['<html>'])))).toEqual({
      title: 'Choose an organisation first',
      body: 'Choose an organisation to view as before exporting data.',
    })
  })

  it('a 403 says only an Admin can export', async () => {
    expect(await exportFailure(answered(403, blobOf({})))).toEqual({
      title: "You can't export this organisation's data",
      body: 'Only an Admin can download a full export.',
    })
  })

  it('a 404 says the organisation no longer exists, since trying again never helps', async () => {
    expect(await exportFailure(answered(404, blobOf({ success: false, errors: ['Organisation not found.'] })))).toEqual({
      title: 'That organisation no longer exists',
      body: 'Choose another organisation to view as.',
    })
  })

  it('anything else before the stream started could not be built', async () => {
    expect(await exportFailure(answered(500, blobOf({})))).toEqual({ title: "The export couldn't be built", body: 'Try again in a few minutes. Nothing was saved.' })
    expect(await exportFailure(new Error('boom'))).toEqual({ title: "The export couldn't be built", body: 'Try again in a few minutes. Nothing was saved.' })
  })
})

describe('isWholeZip', () => {
  // The server writes the end-of-central-directory record (PK 05 06, 22 bytes, no comment) last, so only a whole ZIP ends with it.
  const end = [0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]
  it('is true only when the blob ends with the end-of-central-directory record', async () => {
    expect(await isWholeZip(new Blob([new Uint8Array([...new Array(100).fill(1), ...end])]))).toBe(true)
    expect(await isWholeZip(new Blob([new Uint8Array(2048)]))).toBe(false)
    expect(await isWholeZip(new Blob([new Uint8Array([...end, 1, 2, 3])]))).toBe(false)
    expect(await isWholeZip(new Blob([]))).toBe(false)
  })
})
