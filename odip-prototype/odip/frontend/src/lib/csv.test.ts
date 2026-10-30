import { describe, expect, it, vi } from 'vitest'
import { csvCell, csvFileName, downloadCsv, toCsv } from './csv'

describe('csvCell', () => {
  it.each(['=SUM(A1)', '+1', '-x', '@x', '\t=1', '\r=1'])('prefixes the formula-looking text %j with an apostrophe', (text) => {
    expect(csvCell(text).replace(/^"/, '')).toMatch(/^'/)
  })

  it('leaves numbers alone, including negatives, and never prefixes them', () => {
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(12)).toBe('12')
  })

  it('writes a fractional number to two decimals', () => {
    expect(csvCell(1234.5)).toBe('1234.50')
  })

  it('writes null and undefined as an empty cell and booleans as true or false', () => {
    expect([csvCell(null), csvCell(undefined), csvCell(true), csvCell(false)]).toEqual(['', '', 'true', 'false'])
  })

  it('quotes text holding a comma, quote or line break, doubling the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })
})

describe('toCsv', () => {
  it('starts with a byte order mark, ends rows with CRLF and keeps column order', () => {
    const csv = toCsv(['Name', 'Hours'], [['Ann', 1.5], ['Bo', null]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('Name,Hours\r\nAnn,1.50\r\nBo,\r\n')
  })
})

describe('csvFileName', () => {
  it('names the file after the report and the range', () => {
    expect(csvFileName('leave-taken', '2026-10-19', '2026-11-01')).toBe('leave-taken-2026-10-19-to-2026-11-01.csv')
  })
})

describe('downloadCsv', () => {
  it('saves a UTF-8 text/csv blob under the given name', () => {
    const link = { href: '', download: '', click: vi.fn() } as unknown as HTMLAnchorElement
    vi.spyOn(document, 'createElement').mockReturnValueOnce(link)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()

    downloadCsv('a.csv', 'x')

    expect(link.download).toBe('a.csv')
    expect(link.click).toHaveBeenCalled()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv;charset=utf-8')
  })
})
