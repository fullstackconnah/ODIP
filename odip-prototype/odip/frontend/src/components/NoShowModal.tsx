import { useState } from 'react'
import { Dropdown } from './Dropdown'
import { Modal } from '@/components/Modal'
import { useUpdateClaimLineItem } from '@/api/hooks'
import type { ClaimLineItemDto } from '@/api/types'
import type { DropdownItem } from './Dropdown'

const CANCELLATION_REASONS: DropdownItem[] = [
  { value: 'NSDH', label: 'No show – health reason' },
  { value: 'NSDF', label: 'No show – family issues' },
  { value: 'NSDT', label: 'No show – transport unavailable' },
  { value: 'NSDO', label: 'Other' },
]

interface NoShowModalProps {
  claimId: string
  lineItem: ClaimLineItemDto
  onClose: () => void
  onSuccess: () => void
}

export function NoShowModal({ claimId, lineItem, onClose, onSuccess }: NoShowModalProps) {
  const [reason, setReason] = useState(lineItem.cancellationReason ?? '')
  const [error, setError] = useState('')
  const updateLineItem = useUpdateClaimLineItem()

  function handleConfirm() {
    if (!reason) {
      setError('Please select a reason.')
      return
    }
    setError('')
    updateLineItem.mutate(
      { claimId, itemId: lineItem.id, data: { claimType: 'Cancellation', cancellationReason: reason } },
      { onSuccess }
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <div>
          <span>Record No Show</span>
          <p className="text-sm text-[#43493a] mt-0.5 font-normal">
            {lineItem.participantName}
            <span className="font-mono ml-2 text-xs">{lineItem.ndisNumber}</span>
          </p>
        </div>
      }
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-sm text-[#43493a] hover:bg-[#f5f3ef] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={updateLineItem.isPending}
            className="px-4 py-2 rounded-full bg-[#396200] text-white text-sm font-medium hover:bg-[#294800] transition-all disabled:opacity-50"
          >
            {updateLineItem.isPending ? 'Saving…' : 'Confirm'}
          </button>
        </>
      }
    >
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-[#43493a]">
          Reason <span className="text-red-500">*</span>
        </label>
        <Dropdown
          variant="form"
          items={CANCELLATION_REASONS}
          value={reason}
          onChange={v => { setReason(v); setError('') }}
          label="Select a reason"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </Modal>
  )
}
