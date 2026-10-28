# Primitives B3 design note (impeccable + apple-design), written before the first edit
Mode: Operate (settings). House-component swap, no new visuals. Pill colours (C15/C16) and C22 untouched.

- C19 inputClass: UsersTab, UserFormPanel, TenantFormPanel, TemplateFormPanel, PublicHolidaysSection import `inputClass`/`textareaClass` from components/FormField. Result: Field Grey fill, border, 6px radius, one ring. States kept: focus, error text, disabled, `pl-9` override, `font-mono uppercase`. Textareas (TemplateFormPanel x5, TenantFormPanel) use textareaClass (+ resize-y) so `rows` still works. PublicHolidays width classes move to wrapper divs (w-full vs w-40 would fight).
- C17 search: UsersTab and TenantsTab use SearchInput (house height, Field Grey, aria-label = placeholder). Placeholders unchanged. Users keeps setPage(1). States: empty search, typed text, no results (DataTable empty message unchanged).
- C18 pager: UsersTab hand pager replaced by DataTable `pagination` (PAGE_SIZE 20 kept; house wording "Showing x-y of z" and Previous/Next). States: page 1 (Previous disabled), last page (Next disabled), single page, zero rows.
- C20 switches: Active switch in Tenant/UserFormPanel becomes CheckboxField "Active": real checkbox with accessible name, focus ring, 44px touch pad; same field, same saved value.
- C21 confirms: inline underlined Confirm/Cancel in TemplateFormPanel and ActivityLibraryTab become Button sm (ghost-danger Confirm, ghost Cancel), same flow, same wording; footer keeps flex-wrap for 390px. States: closed, open, cancelled (item untouched), busy.
- C23: TenantDetailView users DataTable gets loading/error/onRetry/emptyMessage; provider settings load uses PageState loading/error. A failed load now says so instead of "No users".
apple-design applied: feedback on press via Button, 44px touch pads on coarse, restraint (no new motion), familiarity (same controls as the rest of the app), reduced motion unaffected.
