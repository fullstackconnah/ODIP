import { inflateSync } from 'node:zlib'

export interface TextRun { text: string; x: number; y: number; width: number; size: number; stream: number }

/** WinAnsi differs from Latin-1 only at 0x80-0x9F: Helvetica writes an en dash as 0x96. These are the ones the PDFs use. */
const WIN_ANSI: Record<number, string> = { 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—' }

function decode(hex: string): string {
  return [...Buffer.from(hex, 'hex')].map(b => WIN_ANSI[b] ?? String.fromCharCode(b)).join('')
}

/** The number of pages: `/Type /Page` objects, not the `/Type /Pages` tree. */
export function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type \/Page(?!s)/g)?.length ?? 0
}

/**
 * Text runs of a react-pdf document with their top-left origin (points), in WinAnsi, and `stream`: the ordinal of the content
 * stream that holds the run, which is the page index. react-pdf writes each Text as q-nested `1 0 0 1 dx dy cm` moves in a
 * y-down page space and a `[<hex> kern ...] TJ` run, then moves right by the run's width.
 */
export function textRuns(pdf: Buffer): TextRun[] {
  const raw = pdf.toString('latin1')
  const runs: TextRun[] = []
  let stream = -1
  for (let at = raw.indexOf('stream'); at >= 0; at = raw.indexOf('stream', at + 9)) {
    const start = raw[at + 6] === '\r' ? at + 8 : at + 7
    const end = raw.indexOf('endstream', start)
    let content = ''
    try { content = inflateSync(pdf.subarray(start, end)).toString('latin1') } catch { continue }
    if (!content.includes(' TJ')) continue
    stream++
    const stack: { x: number; y: number }[] = []
    let pos = { x: 0, y: 0 }, size = 0, last: TextRun | undefined
    for (const line of content.split('\n')) {
      const move = /^1 0 0 1 (\S+) (\S+) cm$/.exec(line)
      if (line === 'q') stack.push({ ...pos })
      else if (line === 'Q') pos = stack.pop() ?? pos
      else if (move) {
        const dx = Number(move[1]), dy = Number(move[2])
        if (last) { last.width = dx; last = undefined } // the move right that follows a run is its width
        pos = { x: pos.x + dx, y: pos.y + dy }
      } else if (/ Tf$/.test(line)) size = Number(line.split(' ')[1])
      else if (line.endsWith(' TJ')) {
        const text = [...line.matchAll(/<([0-9a-f]+)>/g)].map(m => decode(m[1])).join('')
        last = { text, x: pos.x, y: pos.y, width: 0, size, stream }
        runs.push(last)
      }
    }
  }
  return runs
}

/** Runs that touch on one baseline joined back into the line they were typed as: react-pdf starts a new run wherever the font encoding changes (an en dash, for one). */
export function textLines(pdf: Buffer): TextRun[] {
  const lines: TextRun[] = []
  let prev: TextRun | undefined
  for (const run of textRuns(pdf)) {
    if (prev && run.stream === prev.stream && Math.abs(run.y - prev.y) < 0.5 && Math.abs(run.x - (prev.x + prev.width)) < 0.5) {
      prev.text += run.text
      prev.width += run.width
    } else lines.push(prev = { ...run })
  }
  return lines
}
