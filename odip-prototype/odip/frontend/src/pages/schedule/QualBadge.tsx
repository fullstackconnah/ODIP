import React from 'react'

export default function QualBadge({ active, icon: Icon, title }: { active: boolean; icon: React.ElementType; title: string }) {
  if (!active) return null
  return (
    <span title={title} className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-primary-fixed)]/30 text-[var(--color-primary)]">
      <Icon className="w-2.5 h-2.5" />
    </span>
  )
}
