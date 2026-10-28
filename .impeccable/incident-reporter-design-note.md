# Design note: incident Reporter for support workers (Bunya Support)

What: for a SupportWorker the wizard's "Reported By" is the signed-in user's name as fixed text, not a picker.
Where: BasicsStep "Who" card, same position and label, same `span.medium` grid slot.
House component: `ReadOnlyField` (pages/profile/profileHelpers.tsx): a FormField wrapping a disabled+readOnly input, `aria-readonly`, 70% opacity. It keeps the 44px coarse control height and label association. Hint overridden to "Reports you file are saved under your name." (default hint says Intake, wrong here).
States:
- Worker, fresh: own name, no picker, value seeded with own id.
- Worker, MAR / shift-note / shift prefill: the prefill's reporter id is ignored; own id seeded.
- Coordinator/Admin/SuperAdmin, fresh and prefilled: unchanged picker, prefills seed it.
- Review step: "Reported By" shows the worker's own name (same row).
- Edit mode: unchanged (picker); the lock is create-only, as the server rule is about filing.
- 390 and 1440: one grid item at span.medium; no new width; 44px coarse height from --control-h; no overflow.
apple-design applied: familiarity/consistency (same slot, same label), simplicity (no control that cannot be used), agency (hint says why), no motion added.
