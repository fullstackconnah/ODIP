# Shared Dropdown Component — Design Spec

**Date:** 2026-03-25
**Project:** Odip Frontend
**Status:** Approved

---

## Goal

Replace all dropdown-like UI patterns across the platform with a single shared `Dropdown` component. This eliminates duplicated open/close logic, click-outside handling, and styling, and ensures visual consistency across action menus, inline status selects, and form selects.

---

## Component

**Location:** `frontend/src/components/Dropdown.tsx`

### Types

```typescript
type DropdownItem = {
  value: string
  label: string
  icon?: React.ReactNode      // leading icon (menu variant)
  description?: string        // subtitle line (menu variant)
  disabled?: boolean          // greys out item; click is a no-op
}

type DropdownProps = {
  variant: 'pill' | 'form' | 'menu'
  items: DropdownItem[]

  // Value control — pill and form variants
  value?: string
  onChange?: (value: string) => void   // pill + form: fires on item selection
  onSelect?: (value: string) => void   // menu: fires on item selection (no tracked value)
  onBlur?: () => void                  // form: forward field.onBlur from RHF Controller

  // Trigger appearance
  label?: string              // button text (menu), placeholder text (form)
  icon?: React.ReactNode      // leading icon on trigger (menu variant)
  colorClass?: string         // Tailwind color classes for pill trigger background
  disabled?: boolean          // disables trigger; caller is responsible — not auto-applied on empty items
  loading?: boolean           // see Loading State section below

  // Panel alignment relative to trigger — default varies by variant (see each variant section)
  align?: 'left' | 'right'   // 'left' = panel's left edge aligns with trigger's left edge
                               // 'right' = panel's right edge aligns with trigger's right edge
}
```

---

## Variants

### `pill`
- **Trigger:** Compact `rounded-full` badge. Background driven by `colorClass` (from `getStatusColor()`). Shows selected item's `label`.
- **Use case:** Inline table/list edits — booking status, insurance status, assignment role.
- **Behaviour:** `onChange` fires immediately on item selection. No placeholder needed.
- **Panel width:** `min-w-[10rem]`, expands to fit content.
- **Alignment default:** `'right'`.

### `form`
- **Trigger:** Full-width, shows selected label or `label` prop as placeholder text (muted colour). Trailing chevron. No border at rest; hover/focus shows subtle ring matching existing `inputClass` focus style (`focus:ring-2 focus:ring-[#396200]/25`).
- **Use case:** Create/edit form fields — event template, status, lead coordinator, activity type.
- **Behaviour:** `onChange` fires on selection. `onBlur` fires when the panel closes (whether or not a value was selected). Panel is the full width of the trigger (`w-full`).
- **Alignment default:** `'left'` (panel left-aligns under trigger).

### `menu`
- **Trigger:** Green gradient button (`bg-gradient-to-br from-[#396200] to-[#4d7c0f] text-white`) with optional leading `icon`, `label` text, rotating chevron, and `shadow-lg shadow-[#396200]/20`.
- **Use case:** Action menus — Export Trip Package.
- **Behaviour:** Uses `onSelect` callback (no controlled value, `value`/`onChange` are ignored). Items support `icon`, `label`, and optional `description` subtitle. Dividers render between items that have a `description`.
- **Alignment default:** `'right'`.

---

## Shared Behaviour (All Variants)

- **Open/close:** `useState(false)` toggle on trigger click.
- **Click-outside:** `useRef` + `mousedown` listener on `document`. Cleans up when panel closes.
- **Chevron:** Rotates 180° when open (`transition-transform duration-200`).
- **Panel:** `absolute mt-2`, `rounded-2xl`, `shadow-[0_24px_40px_-12px_rgba(27,28,26,0.14)]`, `z-50`, `overflow-hidden`, `bg-white`.
- **Alignment:**
  - `align="left"` → `left-0` on panel
  - `align="right"` → `right-0` on panel (default for `menu` variant)
- **Dividers (menu variant):** `<div className="h-px bg-[rgba(195,201,181,0.25)] mx-4" />` between items that have a `description`.

---

## Keyboard Navigation

The component must be keyboard-operable to replace native `<select>` accessibly.

| Key | Behaviour |
|-----|-----------|
| `Enter` / `Space` | Opens panel when trigger is focused; selects focused item when panel is open |
| `Escape` | Closes panel; returns focus to trigger |
| `ArrowDown` | Opens panel if closed; moves focus to next non-disabled item (wraps) |
| `ArrowUp` | Moves focus to previous non-disabled item (wraps) |
| `Tab` | Closes panel |

**ARIA:** Trigger has `aria-haspopup="listbox"` and `aria-expanded={open}`. Panel has `role="listbox"`. Each item has `role="option"` and `aria-selected` (for `pill`/`form`). Disabled items have `aria-disabled="true"`.

---

## Loading State

When `loading={true}`:
- Trigger is disabled (`pointer-events-none opacity-60`)
- For `menu` variant: label changes to the `label` prop value (caller sets e.g. `label="Exporting…"`)
- For `form`/`pill` variants: a small spinner replaces the chevron icon

---

## Empty Items List

When `items` is empty:
- The panel renders a single non-interactive row: `"No options available"` in muted text
- The trigger is **not** automatically disabled (caller controls this via `disabled` prop)

---

## Disabled Items

A `DropdownItem` with `disabled: true`:
- Renders with `opacity-40 cursor-not-allowed`
- Click and keyboard selection are no-ops

---

## React Hook Form Integration

Form-variant dropdowns are not native inputs, so they cannot use `register()`. Use `<Controller>` instead, forwarding both `onChange` and `onBlur`:

```tsx
<Controller
  control={control}
  name="status"
  render={({ field }) => (
    <Dropdown
      variant="form"
      items={statusItems}
      value={field.value}
      onChange={field.onChange}
      onBlur={field.onBlur}
      label="Select status"
    />
  )}
/>
```

### Special case: `TripCreatePage` event template

The event template select has a side-effect — selecting a template auto-populates `destination`, `region`, and `durationDays` via `setValue`. The Dropdown `onChange` must call both `field.onChange` and the existing side-effect logic:

```tsx
<Controller
  control={control}
  name="eventTemplateId"
  render={({ field }) => (
    <Dropdown
      variant="form"
      items={templateItems}
      value={field.value}
      onChange={val => {
        field.onChange(val)
        onTemplateChange(val)   // existing side-effect function
      }}
      onBlur={field.onBlur}
      label="Select event template"
    />
  )}
/>
```

---

## Rollout — Files to Update

| File | What Changes |
|------|-------------|
| `frontend/src/components/Dropdown.tsx` | **Create** — shared component |
| `frontend/src/components/ItineraryTab.tsx` | Replace Export button + menu → `variant="menu"` |
| `frontend/src/pages/TripDetailPage.tsx` | Replace booking status + insurance `<select>` → `variant="pill"` |
| `frontend/src/pages/SchedulePage.tsx` | Replace role, sleepover type, driver `<select>` → `variant="pill"` / `"form"` |
| `frontend/src/pages/TripCreatePage.tsx` | Replace event template, status, lead coordinator `<select>` → `variant="form"` with `<Controller>`; preserve template side-effect (see above) |
| `frontend/src/components/AddActivityModal.tsx` | Replace library + status `<select>` → `variant="form"` |
| Edit modals in `TripsPage.tsx` + `TripDetailPage.tsx` | Replace `<select>` fields → `variant="form"` |

---

## Out of Scope

- Search inputs with icon overlays (participants search, trips filter bar) — not dropdowns
- Collapsible section toggles in `SchedulePage.tsx` (expand/collapse rows)
- Any `<input type="text">` or `<textarea>` fields
