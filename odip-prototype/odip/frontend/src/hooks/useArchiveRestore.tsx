import { useState, useCallback, type ReactNode } from 'react'
import { ToggleGroup } from '@/components/ToggleGroup'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ActionButtons } from '@/components/ActionButtons'

type ArchiveRestoreConfig<T> = {
  deleteMutation: { mutate: (id: string) => void; isPending: boolean }
  restoreMutation?: { mutate: (args: { id: string; data: any }) => void; isPending: boolean }
  entityName: (item: T) => string
  entityId: (item: T) => string
  archiveVia?: 'isActive' | 'status'
  archiveStatus?: string
  restoreData?: (item: T) => any
  editPath?: (item: T) => string
}

type ArchiveRestoreReturn<T> = {
  showArchived: boolean
  setShowArchived: (v: boolean) => void
  params: Record<string, string>
  toggleButtons: ReactNode
  confirmDialog: ReactNode
  actionButtons: (item: T) => ReactNode
}

export function useArchiveRestore<T>(config: ArchiveRestoreConfig<T>): ArchiveRestoreReturn<T> {
  const [showArchived, setShowArchived] = useState(false)
  const [confirmState, setConfirmState] = useState<{
    type: 'delete' | 'restore'
    id: string
    name: string
    item?: T
  } | null>(null)

  const {
    deleteMutation, restoreMutation, entityName, entityId,
    archiveVia = 'isActive', archiveStatus = 'Cancelled', restoreData, editPath,
  } = config

  const params: Record<string, string> = archiveVia === 'isActive'
    ? { isActive: showArchived ? 'false' : 'true' }
    : showArchived ? { status: archiveStatus } : {}

  const handleDelete = useCallback((item: T) => {
    setConfirmState({
      type: 'delete',
      id: entityId(item),
      name: entityName(item),
    })
  }, [entityId, entityName])

  const handleRestore = useCallback((item: T) => {
    setConfirmState({
      type: 'restore',
      id: entityId(item),
      name: entityName(item),
      item,
    })
  }, [entityId, entityName])

  const handleConfirm = useCallback(() => {
    if (!confirmState) return
    if (confirmState.type === 'delete') {
      deleteMutation.mutate(confirmState.id)
    } else if (restoreMutation && confirmState.item) {
      const data = restoreData
        ? restoreData(confirmState.item)
        : { ...confirmState.item, isActive: true }
      restoreMutation.mutate({ id: confirmState.id, data })
    }
    setConfirmState(null)
  }, [confirmState, deleteMutation, restoreMutation, restoreData])

  const toggleButtons = (
    <ToggleGroup
      options={[
        { key: 'active', label: 'Active' },
        { key: 'archived', label: 'Archived' },
      ]}
      value={showArchived ? 'archived' : 'active'}
      onChange={key => setShowArchived(key === 'archived')}
    />
  )

  const confirmDialog = (
    <ConfirmDialog
      open={confirmState !== null}
      onConfirm={handleConfirm}
      onCancel={() => setConfirmState(null)}
      title={confirmState?.type === 'delete'
        ? `Archive "${confirmState.name}"?`
        : `Restore "${confirmState?.name}"?`}
      message={confirmState?.type === 'delete'
        ? 'This can be undone from the Archived view.'
        : 'This item will be moved back to the active list.'}
      confirmLabel={confirmState?.type === 'delete' ? 'Archive' : 'Restore'}
      variant={confirmState?.type === 'delete' ? 'danger' : 'default'}
      loading={deleteMutation.isPending || restoreMutation?.isPending}
    />
  )

  const actionButtons = useCallback((item: T) => (
    <ActionButtons
      editTo={editPath?.(item)}
      onDelete={() => handleDelete(item)}
      onRestore={restoreMutation ? () => handleRestore(item) : undefined}
      showArchived={showArchived}
    />
  ), [showArchived, editPath, handleDelete, handleRestore, restoreMutation])

  return {
    showArchived, setShowArchived, params,
    toggleButtons, confirmDialog, actionButtons,
  }
}
