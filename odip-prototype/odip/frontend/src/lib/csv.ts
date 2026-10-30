import { saveBlob } from '@/lib/downloadFile'

export type CsvValue = string | number | boolean | null | undefined

/** One cell. Text that a spreadsheet would run as a formula gets an apostrophe in front; numbers are never prefixed. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (typeof value === 'boolean') return String(value)
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Headers and rows as CSV text: a byte order mark so Excel reads UTF-8, CRLF line ends. */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return '﻿' + [headers, ...rows].map((row) => row.map(csvCell).join(',') + '\r\n').join('')
}

export const csvFileName = (report: string, from: string, to: string) => `${report}-${from}-to-${to}.csv`

export function downloadCsv(filename: string, csv: string): void {
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
}
