import { Card } from './Card'

export type StatCardProps = {
  label: string
  value: string | number
  className?: string
}

export function StatCard({ label, value, className }: StatCardProps) {
  return (
    <Card compact className={className}>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-1 font-medium">{label}</p>
      <p className="text-2xl font-display font-bold text-[var(--color-primary)]">{value}</p>
    </Card>
  )
}
