import { CircleCheck } from 'lucide-react'
import { StatCard, type StatCardAction } from '@/components/StatCard'
import { joinList } from '@/lib/format'
import { TONE } from '@/lib/tone'
import { BAND_GRID_CLASS, BAND_SPAN_CLASS, bandTileStyles } from './bandLayout'

/** One thing the dashboard counts for somebody to act on. */
export type BandItem = {
  label: string
  /** How the All clear row and field name the item when it is at zero: a noun that reads without its tile ("overdue tasks" for "Overdue"). Defaults to the label. */
  noun?: string
  count: number
  /** The tone a count above zero takes: danger (the error container) or warning (the warning container). */
  tone: 'danger' | 'warning'
  /** What the count means, in one honest line; the tile shows it while the count is above zero. */
  detail: string
  /** Where it is fixed. */
  action: StatCardAction
  /** The request behind the count is in flight, or failed: there is no number to trust yet, so no tint, no action, and never an all-clear. */
  loading?: boolean
  error?: boolean
  /** The route the placeholder tile (loading or failed) stays a link to. */
  to?: string
}

// "Needs attention" as an answer, not a row of equal counters (DESIGN.md "Attention band"). An item that needs somebody is a tall tile, tinted by its tone, with its
// figure, a line saying what it means and a link to where it is fixed; an item at zero is not a tile at all but a name in ONE "All clear" row on Pale Sprout (the
// system's all-clear green), and when every item is at zero the whole band is that one field. An item with no data is neither: it is a quiet en-dash tile, so an
// all-clear is never claimed without the data behind it.

function AllClearRow({ labels }: { labels: string[] }) {
  return (
    <p className={`flex items-start gap-2 rounded-md px-[var(--section-gap)] py-[var(--card-pad)] text-[13px] ${TONE.success.solid}`}>
      <CircleCheck className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-semibold">All clear</span> on {joinList(labels)}
      </span>
    </p>
  )
}

function AllClearField({ labels }: { labels: string[] }) {
  return (
    <div className={`flex items-center gap-3 rounded-md px-[var(--section-gap)] py-[var(--section-gap)] ${TONE.success.solid}`}>
      <CircleCheck className="h-6 w-6 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-semibold">All clear. Nothing needs you right now.</p>
        <p className="text-[13px]">Checked and at zero: {joinList(labels)}.</p>
      </div>
    </div>
  )
}

function Tile({ item }: { item: BandItem }) {
  const noData = item.loading || item.error
  return noData ? (
    <StatCard variant="attention" label={item.label} value={0} to={item.to} loading={item.loading} error={item.error} className="h-full" />
  ) : (
    <StatCard variant="attention" label={item.label} value={item.count} tone={item.tone} detail={item.detail} action={item.action} className="h-full" />
  )
}

export function AttentionBand({ items }: { items: BandItem[] }) {
  if (items.length === 0) return null
  const tiles = items.filter((item) => item.loading || item.error || item.count > 0)
  const clear = items.filter((item) => !item.loading && !item.error && item.count === 0).map((item) => item.noun ?? item.label)
  const styles = bandTileStyles(tiles.length)

  return (
    <section aria-label="Needs attention" className="@container">
      {tiles.length === 0 ? (
        <AllClearField labels={clear} />
      ) : (
        <div className="flex flex-col gap-2">
          <div className={BAND_GRID_CLASS}>
            {tiles.map((item, i) => (
              <div key={item.label} className={BAND_SPAN_CLASS} style={styles[i]}>
                <Tile item={item} />
              </div>
            ))}
          </div>
          {clear.length > 0 && <AllClearRow labels={clear} />}
        </div>
      )}
    </section>
  )
}
