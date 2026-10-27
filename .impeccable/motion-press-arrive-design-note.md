# Motion PR1: press and arrive (design note)
What moves: every Button (components/buttonClasses.ts BASE) squeezes to scale 0.97 on :active; every Callout root (components/Callout.tsx) uses existing animate-fade-in (opacity + 4px rise, 200ms ease-out) on mount.
Values: transition-[color,background-color,border-color,transform] duration-100 ease-out; press and release both 100ms. Transform only, so no layout shift; hit area and focus ring unchanged.
States: rest unchanged; hover colour unchanged; press scale 0.97 (enabled only); release returns in 100ms; disabled: no scale (not-disabled); busy = aria-disabled (house pattern, PageState/WizardNavFooter): no scale (not-aria-disabled); focus ring unchanged; link-styled Buttons get the same squeeze, underline untouched.
Reduced motion: global rule index.css (durations to 0.01ms); no per-component code.
Callout: mount fades; callout present at page load fades with the page's own fade-in (same 200ms, same curve, so the two overlap invisibly); no exit, NoticesRegion dismiss stays instant.
