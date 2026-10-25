/**
 * A server-masked ID ("••••••••7", see ParticipantIdMask) shown as is, but spoken as "Hidden, ends in 7".
 * Only the bullet run (plus its last character) is swapped, so a composite like "••••••••5 (expires …)" keeps its tail.
 * An unmasked value is returned unchanged.
 */
export function MaskedValue({ value }: { value: string }) {
  const m = /(•+)([A-Za-z0-9]?)/.exec(value)
  if (!m) return <>{value}</>
  return (
    <>
      {value.slice(0, m.index)}
      <span aria-hidden="true">{m[0]}</span>
      <span className="sr-only">{m[2] ? `Hidden, ends in ${m[2]}` : 'Hidden'}</span>
      {value.slice(m.index + m[0].length)}
    </>
  )
}
