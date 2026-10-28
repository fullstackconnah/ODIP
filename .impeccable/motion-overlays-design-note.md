# Motion PR 2: dialogs ease in, menu scrim fades with its drawer (design note, written before any edit)

Skills loaded first: ponytail (full), impeccable, apple-design. Mode: Operate. House components: Modal (ConfirmDialog uses it), AppLayout mobile drawer. No new component.
apple-design rules applied: enter and exit mirror the same clock (scrim 200 ms = drawer 200 ms); interruptible (transition, not keyframe, for the menu scrim so open-then-close mid-flight retargets from the live opacity); critically damped feel (no overshoot, 0.97 to 1 only); restraint (occasional use, so small values); reduced motion degrades to instant.

## Modal (enter only, like SlideOver)
- `.modal-scrim` on the overlay div: `scrimIn` 150 ms ease-out. `.modal-panel` on the dialog div: new `modalIn` keyframe, `transform: scale(0.97)` to rest (scale only, no opacity), 160 ms cubic-bezier(0.2,0,0,1), origin centre. Same `transform` style as SlideOver's slideOverIn; only `from` is declared so the end state is the element's own (no lingering transform, so no containing block for fixed children after the animation).
- Both rules sit in the existing `prefers-reduced-motion: no-preference` block next to SlideOver. With reduce set, no animation is declared at all (and the global rule zeroes any).
- Known effect: the panel inherits the scrim's 150 ms ease-out fade; a second fade on the child would multiply into an ease-in start.
- States: open (animates once on mount); opened while another closes (new mount, own animation); ConfirmDialog over a SlideOver (ConfirmDialog is a Modal, the SlideOver is already settled, only the dialog animates); close (unmount, instant, as today); focus (useDialogBehavior focuses on mount, animation does not delay it); backdrop click, Escape, sizes, footer, sticky footer unchanged. No layout shift: only opacity and transform.

## Mobile menu scrim (AppLayout)
- Always mounted, `lg:hidden` kept (display none from lg up, so absent on desktop as before). `transition-opacity duration-200`; open: `opacity-100`; closed: `opacity-0 pointer-events-none`. Same z-[55]: closed it is transparent and pointer-events-none, so it catches no taps and the page and bottom nav stay live.
- Closed: `aria-hidden="true"` (already always set; it is a decorative layer). onClick only closes the drawer; closed it cannot be clicked. Open: click closes.
- Open-then-close mid-transition: CSS transition retargets from the current opacity, no jump. Reduced motion: global rule makes the transition 0.01 ms, end state still applies.
- Test hook change: existing tests assert the scrim is absent when closed; they now assert it is present but opacity-0 and pointer-events-none.
