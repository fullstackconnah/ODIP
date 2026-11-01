import { encode } from 'uqr'

const QUIET = 4

/** The text as a QR code: one SVG path on a white tile (a scanner needs dark on light, so it is white in the dark theme too; plain black and white, not tokens). 176 px, 192 px from md up. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text)
  const cells = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])))
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QUIET} ${-QUIET} ${size + QUIET * 2} ${size + QUIET * 2}`}
      shapeRendering="crispEdges"
      style={{ backgroundColor: 'white' }}
      className="h-44 w-44 shrink-0 rounded-[var(--radius-md)] md:h-48 md:w-48"
    >
      <path d={cells.join('')} fill="black" />
    </svg>
  )
}
