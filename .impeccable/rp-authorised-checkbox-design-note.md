# Design note: "This restrictive practice is authorised" checkbox

Skills called first: ponytail, impeccable, apple-design.

What and where
- AddRestrictivePracticeDialog setup step, under "Restrictive practice type": one CheckboxField, label "This restrictive practice is authorised", unticked by default. Applies to the whole batch.
- RestrictivePracticesTab edit modal: same CheckboxField above "Authorised by", initial state from isRpAuthorised(saved record).
- House component: CheckboxField (components/CheckboxField.tsx), already used in agreement/TravelOptions. It wraps the input and label in one label, so the whole row is a 44px+ target. No new component.
- Single (incident) mode: no checkbox, columns unchanged.

States (dialog)
- Unticked: rows table has Description, Review date, (Linked medication). No authorisation columns. POST sends authorisedBy/authorisationDate null.
- Ticked: Authorised by + Authorisation date columns appear and are required per row. Errors use the existing row-error style: "Row N: add who authorised it" / "Row N: add the date it was authorised" (both shown, joined, when both are missing).
- Untick then re-tick: values kept in row state; never sent while unticked.
- Phone 390: checkbox row is full width, label wraps, hit target >= 44px (CheckboxField). Table collapses to cards as today.
- Hint line (one, optional): "Authorised practices need who authorised it and the date." shown via CheckboxField hint.

States (edit modal)
- Authorised record: opens ticked with values. Unauthorised/inactive-without-both: opens unticked, fields hidden.
- Ticked: both fields shown and required (inline FormField errors). Unticked: hidden, save sends nulls.
- Existing save-failure behaviour (modalError, values survive) unchanged.

apple-design rules applied: respond on press (native checkbox, instant reveal, no animation so nothing to interrupt), restraint (no helper paragraph, one hint), forgiveness (values survive untick/re-tick), familiarity (same checkbox as the rest of the app), 44px targets.
