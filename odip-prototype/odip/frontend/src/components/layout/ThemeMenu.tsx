import { Monitor, Moon, Sun } from 'lucide-react'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { useUiPreferences } from '@/hooks/useUiPreferences'
import type { ThemePreference } from '@/lib/uiPreferences'

const ICON = 'w-4 h-4'
const THEMES: (DropdownItem & { value: ThemePreference })[] = [
  { value: 'light', label: 'Light', icon: <Sun className={ICON} aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className={ICON} aria-hidden="true" /> },
  { value: 'system', label: 'System', icon: <Monitor className={ICON} aria-hidden="true" /> },
]

/** The header's theme menu: the same per-device preference as Settings, Appearance, applied the moment a row is chosen. */
export default function ThemeMenu() {
  const { prefs, setPref } = useUiPreferences()
  const current = THEMES.find(t => t.value === prefs.theme) ?? THEMES[2]
  return (
    <Dropdown
      variant="icon"
      items={THEMES}
      value={current.value}
      onSelect={v => setPref('theme', v as ThemePreference)}
      label={`Theme: ${current.label}`}
      icon={<span className="text-[var(--color-primary)] [&>svg]:w-5 [&>svg]:h-5">{current.icon}</span>}
      triggerClassName="w-8 h-8 pointer-coarse:size-[var(--tap-min)] flex items-center justify-center rounded-full hover:bg-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
    />
  )
}
