const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasObjectRows = (v: unknown[]) => v.some(isObject)

/**
 * The leaves where `b` differs from `a`, as [dotted path, value from b]. An array of primitives is one leaf, and so is an
 * array of objects whose length changed (an index path would no longer address the same row).
 */
export function changedLeaves(a: unknown, b: unknown, path = ''): [string, unknown][] {
  if (isObject(a) && isObject(b)) {
    return Object.keys(b).flatMap((k) => changedLeaves(a[k], b[k], path ? `${path}.${k}` : k))
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && hasObjectRows(b)) {
    return b.flatMap((row, i) => changedLeaves(a[i], row, path ? `${path}.${i}` : String(i)))
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [[path, b]]
}
