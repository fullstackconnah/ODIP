import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

export type ModalProps = {
  open: boolean
  onClose: () => void
  title: string | ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: ReactNode
  children: ReactNode
  className?: string
}

const SIZE_MAP = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export function Modal({ open, onClose, title, size = 'md', footer, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className={`bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-6 w-full ${SIZE_MAP[size]} max-h-[90vh] mx-2 overflow-y-auto ${className ?? ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--color-accent)] rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
        {footer && (
          <div className="flex justify-end gap-3 mt-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
