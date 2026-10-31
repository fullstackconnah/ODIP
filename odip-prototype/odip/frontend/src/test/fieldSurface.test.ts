import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * One field treatment (SHAPE-PR2 §2): a typeable control is the white (raised, in dark) fill with a 3:1 edge, from FormField's `inputClass`
 * and `textareaClass`. These files hand-rolled their own grey `--color-input` slab; the shared pills and icon tiles still use that token on
 * purpose, so this holds only the field files to the shared classes.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const HAND_ROLLED = [
  'pages/medications/MarTab.tsx',
  'pages/medications/ReportTab.tsx',
  'pages/MedicationFormPage.tsx',
  'pages/participant-detail/AddRestrictivePracticeDialog.tsx',
  'pages/portal/components/ShiftNotesSection.tsx',
  'pages/portal/shift/DoseSheet.tsx',
  'pages/portal/shift/finishSteps.tsx',
  'pages/rostering/components/StaffPicker.tsx',
  'pages/LoginPage.tsx',
  'components/SearchInput.tsx',
]

describe('hand-rolled fields use the shared field classes', () => {
  it.each(HAND_ROLLED)('%s paints no field with the grey --color-input slab', file => {
    const source = readFileSync(join(SRC, file), 'utf-8')
    expect(source).not.toContain('--color-input')
    expect(source).toMatch(/inputClass|textareaClass|fieldSurface/)
  })
})
