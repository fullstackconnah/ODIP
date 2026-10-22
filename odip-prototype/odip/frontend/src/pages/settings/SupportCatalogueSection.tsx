import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { useSupportCatalogue } from '@/api/hooks'
import type { CatalogueFileFormat, CatalogueImportPreviewDto, CatalogueImportRowDto, SupportActivityGroupDto, SupportCatalogueItemDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable } from '@/components/DataTable'
import { labelClass } from '@/components/FormField'
import { Modal } from '@/components/Modal'
import { extractErrorMessage, formatDateAu } from '@/lib/utils'
import { retryingAfterError } from '@/lib/queryPhase'

/** What the uploaded workbook's header row showed: the 2026-27 layout (zone prices) or the 2025-26 one (a column per state). */
function catalogueFormatLabel(format: CatalogueFileFormat): string {
  return format === 'StateColumns' ? 'One price per state (2025-26 layout)' : 'National / Remote / Very Remote prices (2026-27 layout)'
}

export default function SupportCatalogueSection() {
  const pageQuery = useSupportCatalogue()
  const { data: groups = [], isLoading: catalogueLoading, isError: catalogueError, refetch: refetchCatalogue } = pageQuery
  const [importing, setImporting] = useState(false)
  const [previewStep, setPreviewStep] = useState<'upload' | 'preview' | null>(null)
  const [preview, setPreview] = useState<CatalogueImportPreviewDto | null>(null)
  const [version, setVersion] = useState('')
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const qc = useQueryClient()

  const allItems = (groups as SupportActivityGroupDto[]).flatMap((g: SupportActivityGroupDto) => g.items ?? [])

  const dayTypeColor = (dt: string) => {
    switch(dt) {
      case 'Weekday': return 'bg-[var(--color-secondary-container)] text-[var(--color-foreground)]'
      case 'Saturday': return 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
      case 'Sunday': return 'bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]'
      case 'PublicHoliday': return 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
      default: return 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setImportError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await apiClient.post('/support-catalogue/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setPreview(data.data)
      setVersion(data.data?.detectedVersion || '')
      setPreviewStep('preview')
    } catch (err: unknown) {
      // The API explains a refusal in errors[0] (ApiResponse.Fail); the old `data.message` read always fell back to the generic text.
      setImportError(extractErrorMessage(err, 'Upload failed'))
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirm() {
    if (!preview) return
    setConfirming(true)
    setImportError(null)
    try {
      await apiClient.post('/support-catalogue/import/confirm', { catalogueVersion: version, rows: preview.rows })
      qc.invalidateQueries({ queryKey: ['support-catalogue'] })
      setPreviewStep(null)
      setPreview(null)
      setImporting(false)
    } catch (err: unknown) {
      setImportError(extractErrorMessage(err, 'Confirm failed'))
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="md" onClick={() => { setImporting(true); setPreviewStep('upload'); setImportError(null) }}>
          Import catalogue
        </Button>
      </div>

      <DataTable
        data={allItems}
        keyField="id"
        sortable
        columns={[
          { key: 'itemNumber', header: 'Item Number', sortable: true, className: 'font-mono text-xs' },
          { key: 'description', header: 'Description', sortable: true },
          {
            key: 'dayType',
            header: 'Day Type',
            sortable: true,
            render: (item: SupportCatalogueItemDto) => (
              <span className={`text-xs px-2 py-0.5 rounded-full ${dayTypeColor(item.dayType)}`}>{item.dayType}</span>
            ),
          },
          { key: 'priceLimit_ACT', header: 'ACT', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_NSW', header: 'NSW', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_NT', header: 'NT', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_QLD', header: 'QLD', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_SA', header: 'SA', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_TAS', header: 'TAS', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_VIC', header: 'VIC', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_WA', header: 'WA', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_Remote', header: 'Remote', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_VeryRemote', header: 'V.Remote', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'effectiveFrom', header: 'Effective From', type: 'date' as const, sortable: true },
        ]}
        loading={catalogueLoading}
        error={catalogueError || retryingAfterError(pageQuery)}
        onRetry={() => refetchCatalogue()}
        emptyMessage="No catalogue items. Import the NDIS Support Catalogue XLSX."
      />

      {/* Import modal */}
      {importing && (
        <Modal
          open
          onClose={() => { setImporting(false); setPreviewStep(null); setPreview(null); setImportError(null) }}
          title="Import NDIS Support Catalogue"
          closeOnBackdrop={false}
          footer={previewStep === 'preview' && preview ? (
            <>
              <Button variant="secondary" size="md" onClick={() => setPreviewStep('upload')}>Back</Button>
              <Button size="md" onClick={handleConfirm} disabled={confirming}>
                {confirming ? 'Importing...' : 'Confirm Import'}
              </Button>
            </>
          ) : undefined}
        >
          <div className="space-y-4">
            {importError && (
              <Callout tone="error">{importError}</Callout>
            )}

            {previewStep === 'upload' && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-muted-foreground)]">Upload the NDIA Support Catalogue .xlsx file to preview changes.</p>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-[var(--color-border)] rounded-[var(--radius-md)] p-[var(--card-pad)] cursor-pointer hover:border-[var(--color-primary)] transition-colors">
                  <span className="text-[var(--color-muted-foreground)] text-sm mb-2">{uploading ? 'Uploading...' : 'Drop .xlsx here or click to browse'}</span>
                  <input type="file" accept=".xlsx" onChange={handleUpload} className="hidden" disabled={uploading} />
                </label>
              </div>
            )}

            {previewStep === 'preview' && preview && (
              <div className="space-y-4">
                <div className="text-sm text-[var(--color-muted-foreground)]">
                  <p>{preview.sourceDocument} — {catalogueFormatLabel(preview.detectedFormat)}</p>
                  <p>Starts {formatDateAu(preview.effectiveFrom)} · {(preview.rows ?? []).length} rows, {preview.legacyItems} legacy</p>
                </div>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-[var(--card-pad)]"><p className="text-xs text-[var(--color-muted-foreground)]">New items</p><p className="text-xl font-bold text-[var(--color-primary)]">{preview.itemsToAdd}</p></div>
                  <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-[var(--card-pad)]"><p className="text-xs text-[var(--color-muted-foreground)]">Updated</p><p className="text-xl font-bold text-[var(--color-warning)]">{(preview.rows ?? []).filter((r: CatalogueImportRowDto) => r.priceChanged).length}</p></div>
                  <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-[var(--card-pad)]"><p className="text-xs text-[var(--color-muted-foreground)]">Unchanged</p><p className="text-xl font-bold text-[var(--color-foreground)]">{preview.itemsUnchanged}</p></div>
                  <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-[var(--card-pad)]"><p className="text-xs text-[var(--color-muted-foreground)]">To end-date</p><p className="text-xl font-bold text-[var(--color-destructive)]">{preview.itemsToDeactivate}</p></div>
                </div>
                {(preview.warnings ?? []).length > 0 && (
                  <div className="bg-[var(--color-warning-container)] rounded-[var(--radius-md)] p-[var(--card-pad)] text-xs text-[var(--color-on-warning-container)] space-y-1">
                    {preview.warnings.map((w: string, i: number) => <p key={i}>&#9888; {w}</p>)}
                  </div>
                )}
                <div>
                  <label htmlFor="catalogue-version" className={labelClass}>Catalogue version</label>
                  <input id="catalogue-version" value={version} onChange={e => setVersion(e.target.value)} className="w-full px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
