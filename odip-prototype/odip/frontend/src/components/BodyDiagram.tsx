import { useId, useState } from 'react'
import { Dropdown, type DropdownItem } from './Dropdown'
import { DataTable, type Column } from './DataTable'
import { Button } from './Button'
import { FormField } from './FormField'
import {
  BODY_REGION_LABELS,
  BODY_REGION_GROUPS,
  INJURY_TYPES,
  INJURY_TYPE_LABELS,
  type BodyRegion,
  type InjuryType,
} from '@/api/types/enums'

export type BodyDiagramInjury = {
  region: BodyRegion
  injuryType: InjuryType
  description: string
}

export type BodyDiagramProps = {
  injuries: BodyDiagramInjury[]
  onAdd: (region: BodyRegion, injuryType: InjuryType, description: string) => void
  onRemove: (index: number) => void
}

const INJURY_TYPE_ITEMS: DropdownItem[] = INJURY_TYPES.map(t => ({ value: t, label: INJURY_TYPE_LABELS[t] }))

// ── Decorative SVG geometry ──────────────────────────────────────────────
// Deliberately simplified/schematic (not anatomically precise) — the SVGs are aria-hidden
// decoration layered on top of the fully-functional button list below; they exist so a sighted
// mouse user gets a visual map, never as the only route to a region. Coordinates are shared
// between the front/back views; only which torso regions render (front: chest/abdomen/pelvis,
// back: upper back/lower back/buttocks) differs between them.
type RectShape = { kind: 'rect'; x: number; y: number; width: number; height: number }
type CircleShape = { kind: 'circle'; cx: number; cy: number; r: number }
type RegionShape = RectShape | CircleShape

const REGION_SHAPES: Partial<Record<BodyRegion, RegionShape>> = {
  Head: { kind: 'circle', cx: 100, cy: 25, r: 18 },
  Face: { kind: 'circle', cx: 100, cy: 32, r: 8 },
  Neck: { kind: 'rect', x: 92, y: 42, width: 16, height: 12 },
  Chest: { kind: 'rect', x: 75, y: 54, width: 50, height: 40 },
  UpperBack: { kind: 'rect', x: 75, y: 54, width: 50, height: 40 },
  Abdomen: { kind: 'rect', x: 78, y: 94, width: 44, height: 30 },
  LowerBack: { kind: 'rect', x: 78, y: 94, width: 44, height: 30 },
  Pelvis: { kind: 'rect', x: 75, y: 124, width: 50, height: 24 },
  Buttocks: { kind: 'rect', x: 75, y: 124, width: 50, height: 24 },
  LeftShoulder: { kind: 'rect', x: 45, y: 54, width: 25, height: 14 },
  RightShoulder: { kind: 'rect', x: 130, y: 54, width: 25, height: 14 },
  LeftUpperArm: { kind: 'rect', x: 25, y: 70, width: 20, height: 45 },
  RightUpperArm: { kind: 'rect', x: 155, y: 70, width: 20, height: 45 },
  LeftElbow: { kind: 'rect', x: 25, y: 115, width: 20, height: 12 },
  RightElbow: { kind: 'rect', x: 155, y: 115, width: 20, height: 12 },
  LeftForearm: { kind: 'rect', x: 22, y: 127, width: 20, height: 40 },
  RightForearm: { kind: 'rect', x: 158, y: 127, width: 20, height: 40 },
  LeftWrist: { kind: 'rect', x: 22, y: 167, width: 20, height: 10 },
  RightWrist: { kind: 'rect', x: 158, y: 167, width: 20, height: 10 },
  LeftHand: { kind: 'rect', x: 20, y: 177, width: 22, height: 20 },
  RightHand: { kind: 'rect', x: 158, y: 177, width: 22, height: 20 },
  LeftHip: { kind: 'rect', x: 75, y: 148, width: 22, height: 16 },
  RightHip: { kind: 'rect', x: 103, y: 148, width: 22, height: 16 },
  LeftThigh: { kind: 'rect', x: 75, y: 164, width: 22, height: 50 },
  RightThigh: { kind: 'rect', x: 103, y: 164, width: 22, height: 50 },
  LeftKnee: { kind: 'rect', x: 75, y: 214, width: 22, height: 14 },
  RightKnee: { kind: 'rect', x: 103, y: 214, width: 22, height: 14 },
  LeftLowerLeg: { kind: 'rect', x: 76, y: 228, width: 20, height: 50 },
  RightLowerLeg: { kind: 'rect', x: 104, y: 228, width: 20, height: 50 },
  LeftAnkle: { kind: 'rect', x: 76, y: 278, width: 20, height: 10 },
  RightAnkle: { kind: 'rect', x: 104, y: 278, width: 20, height: 10 },
  LeftFoot: { kind: 'rect', x: 72, y: 288, width: 26, height: 16 },
  RightFoot: { kind: 'rect', x: 102, y: 288, width: 26, height: 16 },
  // 'Other' has no diagram location — list-only, under its own "Other" heading.
}

const TORSO_FRONT: BodyRegion[] = ['Chest', 'Abdomen', 'Pelvis']
const TORSO_BACK: BodyRegion[] = ['UpperBack', 'LowerBack', 'Buttocks']
const SHARED_REGIONS: BodyRegion[] = (Object.keys(REGION_SHAPES) as BodyRegion[]).filter(
  r => !TORSO_FRONT.includes(r) && !TORSO_BACK.includes(r)
)
const FRONT_VIEW_REGIONS = [...SHARED_REGIONS, ...TORSO_FRONT]
const BACK_VIEW_REGIONS = [...SHARED_REGIONS, ...TORSO_BACK]

type BodySvgProps = {
  view: 'front' | 'back'
  regions: BodyRegion[]
  draftRegion: BodyRegion | null
  hasInjury: (region: BodyRegion) => boolean
  onSelect: (region: BodyRegion) => void
}

function BodySvg({ view, regions, draftRegion, hasInjury, onSelect }: BodySvgProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 320"
      className="h-auto w-full max-w-[150px]"
      data-testid={`body-svg-${view}`}
    >
      {regions.map(region => {
        const shape = REGION_SHAPES[region]
        if (!shape) return null

        const selected = draftRegion === region
        const marked = hasInjury(region)
        const fill = selected
          ? 'var(--color-primary)'
          : marked
          ? 'var(--color-primary-container, #ddd6fe)'
          : 'var(--color-muted, #e5e7eb)'

        const shared = {
          'data-region': region,
          'data-testid': `svg-region-${view}-${region}`,
          onClick: () => onSelect(region),
          fill,
          stroke: 'var(--color-border, #94a3b8)',
          strokeWidth: 1,
          style: { cursor: 'pointer' as const },
        }

        return shape.kind === 'circle' ? (
          <circle key={region} cx={shape.cx} cy={shape.cy} r={shape.r} {...shared} />
        ) : (
          <rect key={region} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={3} {...shared} />
        )
      })}
    </svg>
  )
}

type InjuryRow = BodyDiagramInjury & { _key: string }

/**
 * IN-5: body diagram for recording where an injury occurred (SPEC-04).
 *
 * The always-visible `<fieldset>` of one `<button aria-pressed>` per region, grouped under four
 * headings (Head & Torso / Arms / Legs / Other), is the PRIMARY control — fully operable by
 * Tab + Enter with zero pointer dependency, and the only place an accessible name for a region
 * exists. The two body SVGs (front/back) are `aria-hidden="true"` decoration layered on top:
 * each region's SVG shape fires the exact same `selectRegion` handler as its list-button twin,
 * so a mouse click on the diagram and an Enter/Space on the matching button always produce
 * identical resulting form state — the SVG is never the only route to any region.
 */
export function BodyDiagram({ injuries, onAdd, onRemove }: BodyDiagramProps) {
  const [draftRegion, setDraftRegion] = useState<BodyRegion | null>(null)
  const [draftInjuryType, setDraftInjuryType] = useState<InjuryType>(INJURY_TYPES[0])
  const [draftDescription, setDraftDescription] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const legendId = useId()

  const hasInjury = (region: BodyRegion) => injuries.some(i => i.region === region)

  // Shared by every list button AND every SVG shape — the single source of "a region was
  // picked," so clicking the SVG and activating its list-button twin can never diverge.
  const selectRegion = (region: BodyRegion) => {
    setDraftRegion(prev => (prev === region ? null : region))
    setAddError(null)
  }

  const handleAdd = () => {
    if (!draftRegion) {
      setAddError('Select where on the body the injury occurred.')
      return
    }
    if (!draftDescription.trim()) {
      setAddError('Describe this injury.')
      return
    }
    onAdd(draftRegion, draftInjuryType, draftDescription.trim())
    setDraftRegion(null)
    setDraftInjuryType(INJURY_TYPES[0])
    setDraftDescription('')
    setAddError(null)
  }

  const rows: InjuryRow[] = injuries.map((injury, index) => ({ ...injury, _key: String(index) }))

  const columns: Column<InjuryRow>[] = [
    { key: 'region', header: 'Region', render: row => BODY_REGION_LABELS[row.region] },
    { key: 'injuryType', header: 'Injury type', render: row => INJURY_TYPE_LABELS[row.injuryType] },
    { key: 'description', header: 'Description' },
    {
      key: 'actions',
      header: 'Remove',
      render: (_row, rowIndex) => (
        <button
          type="button"
          onClick={() => onRemove(rowIndex)}
          className="text-sm font-medium text-[var(--color-destructive)]"
        >
          Remove
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <fieldset className="space-y-3">
        <legend id={legendId} className="mb-1 text-sm font-medium text-[var(--color-foreground)]">
          Where did the injury occur?
        </legend>
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="flex-1 space-y-3">
            {BODY_REGION_GROUPS.map(group => (
              <div key={group.heading}>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {group.heading}
                </h4>
                <div role="group" aria-label={group.heading} className="flex flex-wrap gap-1.5">
                  {group.regions.map(region => {
                    const pressed = draftRegion === region
                    const marked = hasInjury(region)
                    return (
                      <button
                        key={region}
                        type="button"
                        aria-pressed={pressed}
                        data-region={region}
                        onClick={() => selectRegion(region)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          pressed
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                            : marked
                            ? 'border-[var(--color-border)] bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
                            : 'border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-foreground)]'
                        }`}
                      >
                        {BODY_REGION_LABELS[region]}
                        {marked && <span aria-hidden="true"> •</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-3" aria-hidden="true">
            <BodySvg view="front" regions={FRONT_VIEW_REGIONS} draftRegion={draftRegion} hasInjury={hasInjury} onSelect={selectRegion} />
            <BodySvg view="back" regions={BACK_VIEW_REGIONS} draftRegion={draftRegion} hasInjury={hasInjury} onSelect={selectRegion} />
          </div>
        </div>
      </fieldset>

      {draftRegion && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Selected region: <strong>{BODY_REGION_LABELS[draftRegion]}</strong>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Injury type" required>
          <Dropdown
            variant="form"
            items={INJURY_TYPE_ITEMS}
            value={draftInjuryType}
            onChange={value => setDraftInjuryType(value as InjuryType)}
          />
        </FormField>
        {/* "Injury Description", not "Description": IN-6 wires this component into the incident
            wizard's details step, which has its own top-level "Description" field for the
            overall incident — an identical label here would collide (two controls with the same
            accessible name on one page, ambiguous for both screen readers and getByLabelText).
            The regex-based label lookups in BodyDiagram.test.tsx (/Description/) still match. */}
        <FormField label="Injury Description" required>
          <textarea
            value={draftDescription}
            onChange={e => setDraftDescription(e.target.value)}
            rows={2}
            placeholder="Describe this injury"
          />
        </FormField>
      </div>

      {addError && (
        <p role="alert" className="text-xs text-[var(--color-destructive)]">
          {addError}
        </p>
      )}

      <Button onClick={handleAdd}>Add injury</Button>

      <DataTable data={rows} columns={columns} keyField="_key" emptyMessage="No injuries recorded yet." />
    </div>
  )
}
