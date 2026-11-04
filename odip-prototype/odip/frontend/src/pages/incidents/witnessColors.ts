import type { Tone } from '@/lib/tone'

// Staff and External are categories of witness, not states: info and neutral.
export const WITNESS_TYPE_COLOR_MAP: Record<string, Tone> = { staff: 'info', external: 'neutral' }
