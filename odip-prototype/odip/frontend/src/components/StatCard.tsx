import { Card } from './Card'

export type StatCardProps = {
  label: string
  value: string | number
  className?: string
}

export function StatCard({ label, value, className }: StatCardProps) {
  return (
    <Card compact className={className}>
      <p className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</p>
      <p className="text-xl font-display font-bold text-[var(--color-primary)]">{value}</p>
    </Card>
  )
}
