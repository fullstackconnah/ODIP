# Motion PR1: press and arrive (design note)
What moves: every Button (components/buttonClasses.ts BASE) squeezes to scale 0.97 on :active; every Callout root (components/Callout.tsx) uses existing animate-fade-in (opacity + 4px rise, 200ms ease-out) on mount.
Values: transition-[color,background-color,border-color,scale] duration-100 ease-out; press and release both 100ms. Scale only (Tailwind 4 compiles scale-* to the scale property, so transitioning transform would snap), so no layout shift; hit area and focus ring unchanged.
States: rest unchanged; hover colour unchanged; press scale 0.97 (enabled only); release returns in 100ms; disabled: no scale (not-disabled); busy = aria-disabled (house pattern, PageState/WizardNavFooter): no scale (not-aria-disabled); focus ring unchanged; link-styled Buttons get the same squeeze, underline untouched.
Reduced motion: global rule index.css (durations to 0.01ms); no per-component code.
Callout: mount fades; a Callout that mounts with a fading page root composes with it (8px rise, not 4; opacity multiplies), so it trails its siblings by a beat within the same 200ms; accepted; no exit, NoticesRegion dismiss stays instant.
