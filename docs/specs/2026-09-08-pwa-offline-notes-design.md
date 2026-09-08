# PWA Offline Shift Notes — Design

Status: Approved 2026-09-08 — design; implementation plan pending.

Support workers currently lose their shift note the instant connectivity drops mid-shift —
`useCreateShiftNote` (`odip-prototype/odip/frontend/src/api/hooks/portal.ts:32-38`) is a bare
Axios POST with no retry, no queue, and no offline awareness at all; `ShiftNotesSection.tsx`
catches the failure and shows "Couldn't save your note. Check your connection and try again.",
and the note text is gone the moment the component re-renders. Nothing in the frontend today
is PWA-shaped — no manifest, no service worker, no client-side storage beyond `localStorage`
for the JWT — and the backend has no idempotency mechanism anywhere, so a naive retry-on-
reconnect risks creating duplicate notes. This spec makes the app installable, keeps the portal
shell and a worker's own already-loaded shifts available offline, and lets a worker write a
shift note with no signal that syncs — exactly once — when the network returns. Everything else
stays online-only, including the Start/Finish flow defined in the sibling spec
`docs/specs/2026-09-08-shift-completion-design.md`, whose own Out of scope section already
defers offline Start/Finish to "a future PWA spec" — this is that spec, and it deliberately does
not pick that work up.

## Product rulings

1. Scope is deliberately narrow: a support worker can **write a shift note while offline** and
   it syncs when connectivity returns. Nothing else works offline — Start/Finish, leave,
   witness approvals, and every office page stay online-only. AI note drafting is deferred
   entirely (see Out of scope).
2. The frontend becomes an installable PWA (manifest + service worker via `vite-plugin-pwa`) so
   that the app shell and the worker's *already-loaded* portal pages remain available when the
   network drops.
3. The **only backend change** is idempotency: an `Idempotency-Key` request header honoured by
   `POST portal/shifts/{id}/notes`, backed by a 24-hour `IdempotencyKey` table, so a retried
   outbox flush never creates a duplicate note.

## Context — what exists today

**No PWA surface exists.** `odip-prototype/odip/frontend/package.json` has no
`vite-plugin-pwa`, `workbox-*`, `dexie`, `dexie-react-hooks`, `idb`, or `localforage` in either
dependency block (confirmed by a full read of the file). Relevant current versions the plugin
additions sit alongside: `react`/`react-dom` `^19.2.0`, `vite` `^7.3.1`, `vitest` `^3.2.7`,
`@tanstack/react-query` `^5.90.21`, `axios` `^1.13.6`. `vite.config.ts`
(`odip-prototype/odip/frontend/vite.config.ts`) registers exactly two plugins — `react()` and
`tailwindcss()` (line 8) — proxies `/api` to `http://localhost:5100`/`$ODIP_API_TARGET` in dev
(lines 14-20), and folds Vitest config into the same file (`environment: 'jsdom'`,
`setupFiles: ['./src/test/setup.ts']`, `globals: true`, `testTimeout`/`hookTimeout: 20000`).
`index.html` has no `<link rel="manifest">`, no `theme-color` meta, and its only icon is
`<link rel="icon" ... href="/vite.svg">` (line 5) — it does carry a `Content-Security-Policy`
meta tag (line 8) this design doesn't need to touch (see §1). `frontend/public/` contains
exactly one file, `vite.svg` — confirmed by listing the directory and by a repo-wide search for
`logo*`/`*.png` under `frontend/src/`, which returns nothing. No brand logo asset exists
anywhere in the tree; icon generation starts from a placeholder.

**TanStack Query has no persistence.** `src/main.tsx` doesn't construct a `QueryClient` at all
(that lives in `App.tsx:58`, `const queryClient = new QueryClient({ ... })`) — it only seeds `localStorage`
for local-dev auto-login (a real minted JWT via `VITE_LOCAL_JWT`, or a mock preview token via
`VITE_MOCK_PREVIEW=1`) and renders `<App />`. No `persistQueryClient`/`localStoragePersister`
import exists anywhere under `frontend/src/` (grepped). The outbox therefore cannot piggyback on
query-cache persistence — it is its own Dexie store (§2).

**`client.ts`'s interceptor shape.** `src/api/client.ts`
(`odip-prototype/odip/frontend/src/api/client.ts`, 142 lines) exports a single `apiClient` Axios
instance (`baseURL: '/api/v1'` by default, `withCredentials: true`, lines 6-10). A request
interceptor (lines 31-45) attaches `Authorization: Bearer <odip_token>` plus
`X-View-As-Tenant`/`X-View-As-User` from `localStorage` on every request — this is exactly where
a per-request `Idempotency-Key` header would need to be layered on top, not globally (see §3):
the header must be set per-call by the outbox syncer and by the online create path, not
injected blindly for every POST. A response interceptor (lines 47-91) handles a single-retry
401 flow: a singleton `refreshPromise` (line 13) dedupes concurrent 401s, `/auth/logout`'s own
401 is never retried (line 51), otherwise it exchanges a refreshed Firebase ID token at
`/auth/exchange` and retries the original request once (`config._retried` guard, line 54),
falling through to `logout()` (clears five `localStorage` keys, redirects to `/login`) on
failure. The outbox syncer's 401 handling (§2) rides this same interceptor unchanged — it
doesn't need its own refresh logic, only its own "stop and retry next trigger" behaviour when
the retried request still comes back 401/fails.

**The create-note request/response shape.** `useCreateShiftNote`
(`odip-prototype/odip/frontend/src/api/hooks/portal.ts:32-38`):

```ts
export function useCreateShiftNote(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => apiPost<ShiftNoteDto>(`/portal/shifts/${shiftId}/notes`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-shift-notes', shiftId] }),
  })
}
```

The mutation takes a bare `string`, not an object — the outbox wrapper (§2) changes this
signature. The read side, `useShiftNotes` (same file, lines 24-30), keys its query
`['portal-shift-notes', shiftId]` — the exact key the outbox syncer invalidates on a successful
flush. **Correction to an assumption in the approved brief:** the request DTO,
`CreateShiftNoteDto` (`odip-prototype/odip/backend/Odip.Application/DTOs/ShiftNoteDTOs.cs:27-31`),
carries only `Body` (`[Required, StringLength(1000, MinimumLength = 1)]`) — there is no
client-supplied `flags` field to mirror into the outbox row. `ShiftNote.FlaggedCategories`
(`odip-prototype/odip/backend/Odip.Domain/Rostering/RosteringEntities.cs:174-217`) is always
computed server-side by `ShiftNoteKeywordScanner.Scan(note.Body)` at save time
(`PortalController.CreateShiftNote`, line 211) — never sent by the client and never editable by
it. The outbox schema (§2) reflects this: no `flags` column.

**`PortalController.CreateShiftNote`**
(`odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs:190-216`) follows the
controller's universal self-scoping idiom: `ResolveCurrentStaffIdAsync` resolves the caller's
own staff id (line 194; defined line 537), then `_db.Shifts.AnyAsync(s => s.Id == id &&
s.UserId == staffId.Value, ct)` (line 198) checks ownership — either miss returns the identical
404 `"Shift not found."` (never 403, matching every other action on this controller, including
the sibling shift-completion spec's Start/Finish actions). This is the exact 404 an outbox row
will surface as "shift no longer assigned to me" if a coordinator reassigns the shift while the
worker is offline (see Error handling).

**`ShiftNotesSection.tsx`**
(`odip-prototype/odip/frontend/src/pages/portal/components/ShiftNotesSection.tsx`) renders the
note list and the add-note form, called last from `PortalShiftDetailPage.tsx`
(lines 254-262). `handleSubmit` (`ShiftNotesSection.tsx:105-116`) calls
`createNote.mutateAsync(trimmed)` inside a `try/catch` that currently treats every failure —
network or server — identically: "Couldn't save your note. Check your connection and try
again." (line 114). This is the exact branch point offline/network-error detection (§2) hooks
into. The component has no notion of shift status gating the form (own doc comment, lines
77-82: "There is no shift-completion event to gate this on" — still true).

**No toast/notification component exists.** The approved brief assumes an "existing
toast/notification component" for the service-worker update prompt; a full search of
`frontend/src/components/` (36 top-level files) and a grep for
`toast|Toast|Toaster|useToast|sonner|react-hot-toast` across `frontend/src/` returns nothing.
The closest patterns are inline: `ShiftNotesSection.tsx`'s own `role="alert"` error paragraphs
and `ParticipantAlertsBanner.tsx` (`odip-prototype/odip/frontend/src/components/
ParticipantAlertsBanner.tsx`) — a severity-styled, dismissible banner row (`role="alert"` for
Critical, `role="status"` otherwise, lines 33-39) rendered inline in a page, not a global
overlay. This design introduces one small new component, `Toast.tsx` (§1), following those two
files' visual language (`--color-*` tokens, `role="status"`/`role="alert"`) rather than pulling
in an external toast library.

**Nav badge precedent.** `AppLayout.tsx`
(`odip-prototype/odip/frontend/src/components/layout/AppLayout.tsx`) already renders two
read-time count badges via a shared `NavCountBadge` component (line 10) —
`pendingWitnessCount` (line 91, 60 s poll) and `pendingLeaveCount` (line 96, gated behind
`canApproveLeave` so `SupportWorker` sessions never poll a controller they can't reach) — the
precedent the outbox's pending-count badge (§2) follows as a third badge alongside these two.

**Primary colour token / brand.** `frontend/src/index.css` defines `--color-primary: #396200`
(line 11), `--color-background: #fbf9f5` (line 5) — the manifest's `theme_color`/
`background_color` (§1) reuse these exactly, matching `AppLayout.tsx`'s own brand block
(`bg-[#4d7c0f]`/`text-[#dfffb7]`, lines 159-160).

**CSP already permits a same-origin service worker with no change.** Three places declare CSP:
`index.html`'s meta tag (line 8, `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ...`),
`nginx/default.conf`'s `add_header Content-Security-Policy` (line 51, same `default-src 'self'`
base plus `frame-ancestors 'none'`), and `Program.cs`'s inline security-headers middleware
(line 496, applies only to API JSON responses, not the static SPA shell nginx serves directly).
Neither of the two that govern the served page declares `worker-src`/`manifest-src` — per the
CSP fallback chain, `worker-src` falls back to `child-src` then `script-src` (`'self'`), and
`manifest-src` falls back to `default-src` (`'self'`). A same-origin `sw.js` and
`manifest.webmanifest` are already permitted; this spec adds no CSP directive anywhere.

**No existing action filter, no `Options<T>` classes.** `odip-prototype/odip/backend/Odip.Api/`
has no `Filters/` directory today (confirmed by search) — `IdempotentAttribute` (§3) is the
first ASP.NET Core action filter in this codebase, following the plain-attribute/`IActionFilter`
shape rather than a `ServiceFilter`, since there's no DI-heavy filter precedent to match either
way. Config convention is confirmed direct `IConfiguration.GetValue<T>` (no `Options` classes
exist anywhere — same finding the leave and shift-completion specs already made against
`HolidaySyncBackgroundService.cs:78-83`).

**Entity-configuration precedent for a non-tenant table.** `AuditLog`
(`odip-prototype/odip/backend/Odip.Infrastructure/Data/OdipDbContext.cs:799-809`) is the
existing example of a table with no `TenantId`/`ITenantEntity` at all — just `HasKey`,
`Property` length/required configs, and two plain indexes. `CaregiverProfileSubmission`
(same file, ~line 649-653) is the existing partial-unique-index precedent
(`.HasFilter("\"Status\" IN (0, 1)")`) already reused by the shift-completion spec — this spec's
`IdempotencyKey.Key` needs only a plain (non-partial) unique primary key, so it follows
`AuditLog`'s shape more closely than `CaregiverProfileSubmission`'s.

**Mock API has no route for this endpoint today.** `mock-api/server.js`'s `postRoutes` array
(`odip-prototype/odip/mock-api/server.js:859-880`) — a list of `[pattern, handler(...params,
body)]` tuples matched before a generic fallback — has no entry for `portal/shifts/:id/notes`.
A POST there currently falls all the way through to the generic echo handler
(`server.js:983-989`): `{ id: <path-tail-or-timestamp>, ...body }`, i.e. today's mock API already
returns a note-shaped object with no `authorName`/`createdAt`/`flaggedCategories` — the frontend
against mock-api is already tolerant of a partial `ShiftNoteDto`. Adding the idempotency-replay
behaviour (§3) requires a dedicated handler, and — since `postRoutes` handlers currently receive
only `(...params, body)`, with no access to request headers — a small change to the dispatch
loop (`server.js:956-963`) to also pass `req.headers` through, plus a matching change to `send()`
(`server.js:906-910`) so a handler can request extra response headers alongside the JSON body.

## 1. PWA shell

**Plugin.** `vite-plugin-pwa` `^1.0.1` (the first release line with confirmed Vite 7 support;
the implementation plan will pin the exact patch against npm at build time) added as a
`devDependency` alongside the existing `@vitejs/plugin-react`/`@tailwindcss/vite` plugins in
`vite.config.ts`. Registered with:

- `registerType: 'prompt'` — **not** `'autoUpdate'`. A worker mid-note must never have the page
  silently reloaded under them by an auto-applied update; `'prompt'` fires an `onNeedRefresh`
  callback instead, which drives a small "Update available — reload" `Toast` (new component,
  `frontend/src/components/Toast.tsx`, following the `role="status"` + `--color-*` token pattern
  in `ParticipantAlertsBanner.tsx`, per Context above) with a "Reload" button that calls the
  registration's `updateSW(true)`. Dismissing the toast leaves the old service worker running
  until the next natural page load.
- `injectRegister: 'auto'` — the plugin injects its own `virtual:pwa-register` bootstrap into
  the built `index.html`; no manual `navigator.serviceWorker.register()` call is added to
  `main.tsx`.

**Workbox `generateSW` strategy.** Precache the built app shell (JS/CSS/HTML — the plugin's
default `globPatterns` behaviour is sufficient, no custom list needed). Runtime caching rules,
in priority order:

| Match | Strategy | Notes |
|---|---|---|
| `GET /api/v1/portal/shifts*` (list + detail) | `NetworkFirst` | 24 h `maxAgeSeconds`, `networkTimeoutSeconds: 3` — a flaky connection falls back to cache fast rather than hanging |
| `GET /api/v1/portal/shifts/*/notes` | `NetworkFirst` | same 24 h / 3 s config — a worker reopening a shift they already viewed sees their own last-synced notes offline |
| `GET /api/*` (everything else) | `NetworkOnly` | office data (participants, claims, rostering, etc.) must never be served stale |
| `/auth/*` | not cached (excluded from all runtime-caching entries) | token exchange/logout must always hit the network |

**PII residual-risk statement.** Cached `portal/shifts*` and `portal/shifts/*/notes` responses
contain participant PII (name, medical summary, behaviour/risk summary, mobility/equipment
notes — see the fields rendered in `PortalShiftDetailPage.tsx:115-224`) and are stored
client-side in the browser's Cache Storage, outside the app's normal auth boundary once written.
Mitigations: (a) `PortalController`'s self-scoping (Context, above) means only the calling
worker's own assigned shifts are ever fetched or cached — no participant outside that worker's
roster is reachable; (b) the `NetworkFirst` cache entries expire after 24 h regardless of login
state; (c) on logout (`client.ts`'s `logout()`, lines 19-28), the outbox syncer additionally
calls `caches.keys()` → `caches.delete()` on every Workbox runtime cache and clears the
`odip-offline` Dexie database (§2) before the redirect to `/login` fires. The residual risk —
a stolen or unlocked device within that 24 h window — is not eliminated by any of this and is
carried to Open questions.

**Manifest.** `manifest.webmanifest` (generated by the plugin, not hand-written):

```json
{
  "name": "ODIP",
  "short_name": "ODIP",
  "description": "ODIP — NDIS Trip Management Platform",
  "display": "standalone",
  "start_url": "/portal",
  "theme_color": "#396200",
  "background_color": "#fbf9f5",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`theme_color`/`background_color` are lifted directly from `index.css`'s `--color-primary`/
`--color-background` tokens (Context, above). Icons are generated into
`frontend/public/icons/` at implementation time from a placeholder (a simple monogram on the
`#396200` brand green) since — per Context — no existing logo asset exists anywhere in the
repository to derive them from; swapping in a real brand mark later is a files-only change with
no code impact.

**Dev experience.** `devOptions.enabled: false` (the plugin's default) — the service worker is
only registered in production builds (`npm run build` output), never under `npm run dev`, so
`vite dev`'s HMR is unaffected. Under Vitest, the plugin must not run at all: `vite.config.ts`
guards plugin registration with `...(process.env.VITEST ? [] : [VitePWA({ ... })])` in the
`plugins` array — `VITEST` is set automatically by Vitest's own process environment, the same
signal Vitest itself uses internally, so no new env var needs to be threaded through
`package.json`'s `test`/`test:watch` scripts.

**Docker / nginx.** `frontend/Dockerfile`
(`odip-prototype/odip/frontend/Dockerfile:22-23`, `RUN npm test` then `RUN npm run build`) needs
no change — the plugin's `generateSW` output lands in `dist/` alongside the rest of the Vite
build and is copied to the nginx image by the existing
`COPY --from=build /app/dist /usr/share/nginx/html` line. `nginx/default.conf`
(`odip-prototype/odip/nginx/default.conf`) does need one addition: its existing static-asset
cache rule (`location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ { expires 1y;
... }`, lines 40-43) would otherwise catch `sw.js` under its `.js` suffix and serve it
`Cache-Control: public, immutable` for a year — exactly wrong for a file that must be
re-fetched and diffed on every page load for updates to ever be detected. Two new `location`
blocks are inserted **before** that regex block (nginx evaluates an exact-match `location =`
before a regex `location ~*`, so ordering here is defence-in-depth, not load-bearing, but keeping
them adjacent and above the generic rule keeps the file readable):

```nginx
location = /sw.js {
    add_header Cache-Control "no-cache";
    expires off;
}
location = /manifest.webmanifest {
    add_header Cache-Control "no-cache";
    default_type application/manifest+json;
}
```

## 2. Offline note outbox (frontend)

**Storage.** `dexie` `^4.4.5` + `dexie-react-hooks` `^4.4.0` (current majors as of this design;
plan confirms exact pins against npm), a new Dexie database `odip-offline`
(`frontend/src/lib/offlineDb.ts`, new file) with two tables:

```ts
interface NoteOutboxRow {
  id: string          // uuid v4, generated at compose time — doubles as the Idempotency-Key
  shiftId: string
  body: string
  createdAt: string   // ISO, client clock — display-only, never trusted for ordering vs. server data
  attempts: number
  lastError?: string
  status: 'pending' | 'syncing' | 'failed' | 'conflict'
}
interface OutboxMeta {
  key: 'userId'
  userId: string       // the odip_user id this outbox belongs to
}
```

No `flags` column — per the Context correction above, `CreateShiftNoteDto` carries only `Body`;
`FlaggedCategories` is always server-computed and is simply absent from an outbox row until the
server responds. `'conflict'` status is defined but unused in v1 (notes are create-only, no
edit-offline path — see Out of scope); it's reserved rather than added later to avoid a schema
migration for a one-value enum change.

**User-switch wipe.** On every successful login, the syncer module (below) reads
`OutboxMeta.userId`; if it's set and differs from the freshly-logged-in `odip_user.id`, and
`noteOutbox` has any non-empty rows, a `ConfirmDialog`
(`frontend/src/components/ConfirmDialog.tsx` — pattern already used by
`LeaveApprovalsPage`'s decline flow) asks "N unsynced notes from another account will be
discarded. Continue?" before clearing both tables and writing the new `userId`. If there are no
pending rows, the wipe happens silently. This guards the exact shared-device risk the brief
calls out: a second worker logging into the same tablet must never have their session flush the
first worker's queued notes under the new JWT.

**`useCreateShiftNote` wrapper.** The hook's mutation signature changes from `(body: string)` to
accept the same string but branch internally:

```ts
export function useCreateShiftNote(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: string) => {
      if (!navigator.onLine) return writeToOutbox(shiftId!, body)   // never touches the network
      try {
        return await apiPost<ShiftNoteDto>(`/portal/shifts/${shiftId}/notes`, { body },
          { headers: { 'Idempotency-Key': crypto.randomUUID() } })
      } catch (err) {
        if (isAxiosError(err) && !err.response) return writeToOutbox(shiftId!, body)  // network error, no response at all
        throw err   // real 4xx/5xx — surfaces exactly as today, no outbox write
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-shift-notes', shiftId] }),
  })
}
```

The `Idempotency-Key` is generated **at compose time** (inside this same mutation call), not
only by the outbox syncer — so an online POST that times out client-side *after* the server
already committed the note is equally safe to retry: the same key is reused if the caller
retries manually, and the same key is what gets written into `noteOutbox` if the immediate retry
also fails offline. `writeToOutbox` inserts a `NoteOutboxRow` with `status: 'pending'` and
returns a synthetic `ShiftNoteDto`-shaped object (`id` = the outbox row id, `authorName`/
`createdAt` filled from the current session, `flaggedCategories: []`) so the calling code doesn't
need to special-case the return shape.

**Merged rendering.** `ShiftNotesSection.tsx` gains a `useLiveQuery` (from
`dexie-react-hooks`) over `noteOutbox.where('shiftId').equals(shiftId)`, merges those rows
*before* the server-returned `notes` array (outbox rows first — most recent offline work is what
a worker most wants to confirm was captured), and renders each outbox row with a "Pending sync"
chip (small `--color-warning-container` pill, matching the existing `Chip`/`FlagBanner` colour
vocabulary already in this file) instead of the author/timestamp line. A `'failed'` row instead
shows its `lastError` plus **Retry** (re-enqueues as `'pending'`, resets `attempts` to 0) and
**Discard** (deletes the row, behind `ConfirmDialog`) actions. `handleSubmit` (lines 105-116)
needs no further change beyond what the hook wrapper above already absorbs — its existing
`catch` block only fires for a genuine post-outbox-write error path (Dexie write failure — see
Quota below), which is vanishingly rare.

**`OutboxSyncer`.** A module (`frontend/src/lib/outboxSyncer.ts`, new file) started once —
imported and invoked from `main.tsx` after `createRoot(...).render(...)`, not from a component,
so it survives route changes and isn't remounted. It flushes `pending` rows sequentially, oldest
`createdAt` first, one row in flight at a time (never parallel — avoids the server seeing two
concurrent creates for the same shift race each other), triggered by:

- the `window` `'online'` event,
- `document`'s `'visibilitychange'` firing to `'visible'` (app regains focus),
- a 60 s `setInterval` that only runs while at least one `pending` row exists (cleared/re-armed
  as the count changes, so an idle app with an empty outbox does nothing every minute forever),
- immediately after a successful login.

Per-row flush: `apiPost` to `/portal/shifts/{shiftId}/notes` with `Idempotency-Key: <row.id>`.

| Outcome | Action |
|---|---|
| 2xx | Delete the row; invalidate `['portal-shift-notes', shiftId]` |
| 2xx carrying `Idempotent-Replayed: true` (server replayed a stored response — §3) | Treated identically to a plain 2xx — delete + invalidate |
| Network error (no `error.response`) | `attempts += 1`; stays `pending`; stop this flush pass (don't attempt later rows out of order behind a dead connection) |
| 401 | Stop the whole flush pass — the response interceptor in `client.ts` already ran its refresh-and-retry; if that retry itself failed the user is being logged out, so there's nothing left to flush against. If it succeeded transparently, the underlying `apiPost` call already returned 2xx and this branch is never reached. Next trigger (focus/online/interval) retries. |
| 404 (shift no longer the worker's own — reassigned while offline) | Mark `'failed'`, `lastError = "This shift is no longer assigned to you."`; offer Discard only (no Retry — a 404 here can't self-heal) |
| Any other 4xx (422 `IDEMPOTENCY_KEY_REUSED` with a genuinely different body hash — shouldn't happen since the key is a fresh uuid per row, but handled defensively) | Mark `'failed'` with the server's message; Retry + Discard both offered |
| `attempts` reaches 20 | Mark `'failed'` with `lastError = "Sync failed after 20 attempts."` regardless of the underlying error, so a permanently-broken row never retries forever in the background |

**Background Sync (best-effort accelerator).** The service worker additionally registers a
Workbox Background Sync queue tagged `'note-outbox'` for the same route, so a Chromium browser
can flush a queued write even with the tab closed. This is a bonus path, not the source of
truth — the in-page `OutboxSyncer` owns retries, attempt-counting, and UI state regardless of
whether Background Sync also fires (a duplicate attempt from both paths is safe purely because
of the idempotency key). Safari on iOS has no Background Sync API at all; those workers rely
entirely on the in-page syncer's `'visibilitychange'`/foreground triggers, which is why that
trigger is load-bearing, not a nice-to-have.

**UI.** `OfflineBanner.tsx` (new file, `frontend/src/pages/portal/components/OfflineBanner.tsx`)
renders inside `PortalShiftDetailPage.tsx` (and `PortalShiftsPage.tsx`'s list view) whenever
`!navigator.onLine`, tracked via the same `'online'`/`'offline'` window events the syncer
listens to: "You're offline. Notes you write will sync when you're back online." Every other
action button on the portal shift-detail page is disabled with a `title` tooltip explaining why
while offline (witness approvals, leave withdrawal, and — once shipped — the sibling spec's
Start/Finish buttons); the note composer itself stays fully enabled. `AppLayout.tsx`'s nav gains
a third `NavCountBadge` (Context, above — the same component `pendingWitnessCount`/
`pendingLeaveCount` already use) on the "My Shifts" entry, driven by a `useLiveQuery` count of
`pending`-or-`failed` outbox rows, so the badge is visible from anywhere in the app, not just on
the shift-detail page itself.

**Storage bound / quota.** Outbox rows are small (a body capped at 1000 characters, per
`CreateShiftNoteDto`'s `StringLength` — Context above); no photo/file attachments exist in this
feature (Out of scope). A Dexie write throwing `QuotaExceededError` is caught in `writeToOutbox`
and surfaced as the new `Toast` component ("Couldn't save offline — device storage is full.")
without clearing the composer's text, so the worker can copy it out manually or free up space
and retry — the note is never silently lost mid-failure.

## 3. Backend idempotency (the only backend change)

**Entity** (`odip-prototype/odip/backend/Odip.Domain/Idempotency/IdempotencyKey.cs`, new file
and new folder, sibling to `Rostering/`):

```csharp
public class IdempotencyKey
{
    public string Key { get; set; } = string.Empty;   // PK, ≤128 chars — the client-supplied uuid
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public string Route { get; set; } = string.Empty;       // e.g. "POST portal/shifts/{id}/notes"
    public string RequestHash { get; set; } = string.Empty; // SHA-256 hex of the raw request body
    public int ResponseStatus { get; set; }
    public string ResponseBody { get; set; } = string.Empty; // jsonb — the serialised ApiResponse<ShiftNoteDto>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```

**Not `ITenantEntity`.** Unlike every other domain entity touched by this repo's recent specs,
`IdempotencyKey` deliberately does *not* implement `ITenantEntity`. The lookup happens by `Key`
alone, before the request has necessarily resolved a tenant context the way a normal
tenant-scoped query would — the filter runs inside the action-filter pipeline, at the same point
`ICurrentTenant` is already populated (auth middleware runs before MVC action filters in
`Program.cs`'s pipeline — see Context), so `TenantId` *is* available and is still stored and
checked; it's just not the entity's *scoping* mechanism the way `OdipDbContext`'s automatic
`ITenantEntity` behaviour is for every other table. `TenantId` and `UserId` are both stored and
both checked on every lookup precisely so one tenant's or one user's key can never replay another
user's stored response, even though the table itself isn't tenant-partitioned by EF's usual
global-filter machinery.

**Table configuration** (`OdipDbContext.cs`, new `modelBuilder.Entity<IdempotencyKey>(...)`
block, following the `AuditLog` shape at lines 799-809 — plain `HasKey`/`Property`/`HasIndex`,
no tenant FK):

```csharp
modelBuilder.Entity<IdempotencyKey>(entity =>
{
    entity.HasKey(e => e.Key);
    entity.Property(e => e.Key).HasMaxLength(128);
    entity.Property(e => e.Route).HasMaxLength(200).IsRequired();
    entity.Property(e => e.RequestHash).HasMaxLength(64).IsRequired();
    entity.Property(e => e.ResponseBody).HasColumnType("jsonb").IsRequired();
    entity.HasIndex(e => e.CreatedAt);
});
```

**`IdempotentAttribute`** (`odip-prototype/odip/backend/Odip.Api/Filters/IdempotentAttribute.cs`,
new file — the first action filter in this codebase, per Context), an `IAsyncActionFilter`
applied only to `PortalController.CreateShiftNote` in v1:

| Case | Behaviour |
|---|---|
| No `Idempotency-Key` header | Pass through unchanged — fully backwards-compatible with every existing caller |
| Header present, no stored row for that key | Execute the action normally; on success (2xx), store the key row in `OnActionExecuted` using the same scoped `OdipDbContext` the controller already used — same `DbContext` instance, so if the action's own `SaveChangesAsync` already committed the note, this is a second, separate `SaveChangesAsync` for the key row (not the same transaction — see Concurrency below) |
| Header present, stored row found, same `UserId`, same `RequestHash` | Short-circuits with `context.Result = new ObjectResult(<stored ResponseBody>) { StatusCode = <stored ResponseStatus> }`, plus `Response.Headers["Idempotent-Replayed"] = "true"`. Always 200, not a distinct 409 variant — a replayed success must look exactly like success to the outbox syncer, which treats any 2xx identically (a considered-and-rejected alternative: a `409 IDEMPOTENT_REPLAY` code, which would have forced the syncer to special-case a 409 as a success, adding a branch for no behavioural benefit) |
| Header present, stored row found, same `UserId`, *different* `RequestHash` | `422 IDEMPOTENCY_KEY_REUSED` — the client reused a key for a different note body, which should never happen given the outbox generates a fresh uuid per row, but is rejected rather than silently overwritten |
| Header present, stored row found, *different* `UserId` | `404` — matches `PortalController`'s never-403 idiom everywhere else on this controller (Context, above); a key collision across users is indistinguishable from "not found" to the caller |
| The action itself threw / returned non-2xx | Nothing is stored — only successful responses are cached for replay, so a legitimate retry after a real validation failure still re-executes the action |

**Transactional subtlety.** The filter's "store on success" step runs in `OnActionExecuted`,
*after* the action method's own `SaveChangesAsync` has already completed — an `IAsyncActionFilter`
can't wrap the controller's `SaveChangesAsync` in the same call without duplicating persistence
logic into the filter, which doesn't fit this codebase's flat controller-calls-`OdipDbContext`
style (no Application-layer abstraction to intercept through). So the filter issues its own
`SaveChangesAsync` for just the `IdempotencyKey` row right after the response is known. This
leaves a narrow window where the note commits but the process crashes before the key row is
written — a same-key retry would then re-execute `CreateShiftNote` and create a second
`ShiftNote`, not replay. Judged acceptable: it needs a process crash in a few-millisecond gap, on
an endpoint whose worst case (an occasional duplicate note) is a visible annoyance, not a billing
or safety defect — unlike a claim-generation endpoint, where this gap would be worth a shared
transaction.

**Concurrency.** The unique PK on `Key` means two concurrent requests with the same
freshly-generated key both attempt an insert; the loser's unique-violation is caught and turned
into a synchronous re-read-and-replay of the winner's now-committed row — functionally identical
to the "found, same hash" branch above, just reached via a caught exception.

**Expiry.** No new hosted service — the only hosted-service precedent in this codebase is
`HolidaySyncBackgroundService` (Context, above), and a dedicated background sweeper isn't
justified for a single small table. Instead, on every idempotent request (i.e., every time the
filter runs with a header present), it opportunistically deletes up to 100 rows where
`CreatedAt < now - RetentionHours` before doing its own lookup —
`Idempotency:RetentionHours` (`IConfiguration.GetValue<int>("Idempotency:RetentionHours", 24)`,
same direct-`IConfiguration` idiom as `HolidaySync:*`, Context above; default 24h per the
product ruling).

**Migration** `AddIdempotencyKeys` — purely additive (one new table, no changes to any existing
one), created after whatever is latest at implementation time (per `Program.cs`'s migration
self-healing constraint — never rename or reorder an existing migration id, Context above).

**`client.ts`.** No global interceptor change. The `Idempotency-Key` header is attached only at
the two call sites that need it — the online create path inside `useCreateShiftNote` and the
`OutboxSyncer`'s flush call (§2) — both passing an explicit `headers` object on the individual
Axios call, exactly as `client.ts`'s existing per-call `{ headers }` option already supports
(no interceptor logic needs to know about idempotency at all).

**Mock API.** A module-level `Set` tracks keys already seen:

```js
const seenIdempotencyKeys = new Set();
```

and `postRoutes` (Context, above) gains a matching entry:

```js
// added to postRoutes:
['portal/shifts/:id/notes', (id, body, headers) => {
  const key = headers['idempotency-key']
  const replayed = key && seenIdempotencyKeys.has(key)
  if (key) seenIdempotencyKeys.add(key)
  return { __extraHeaders: replayed ? { 'Idempotent-Replayed': 'true' } : {}, id: `note-${Date.now()}`, shiftId: id, body: body.body, authorName: 'Preview Worker', createdAt: new Date().toISOString(), flaggedCategories: [] }
}]
```

paired with the small dispatch-loop change noted in Context (`server.js:956-963` passing
`req.headers` as a fourth handler argument, and `send()`, `server.js:906-910`, reading an
optional `__extraHeaders` key off the handler's return value before serialising the rest as the
JSON body) — the minimum plumbing needed for the mock server to demonstrate the replay header at
all, since it has no header-passing mechanism today.

## Data flow

**Happy path, online.** Worker types a note and submits. `useCreateShiftNote` generates a fresh
uuid, POSTs with `Idempotency-Key: <uuid>`. `IdempotentAttribute` sees no stored row, lets
`CreateShiftNote` run, the note is created and returned 200, the filter stores the key row.
`onSuccess` invalidates `['portal-shift-notes', shiftId]`; `ShiftNotesSection` re-fetches and the
note appears with its real author/timestamp — no outbox involvement at all.

**Offline write → reconnect → sync.** Worker loses signal mid-shift, opens a shift they already
viewed today (served from the `NetworkFirst` Workbox cache, §1), and writes a note.
`navigator.onLine` is `false`, so `writeToOutbox` inserts a `NoteOutboxRow` with a fresh uuid id
and `status: 'pending'`; `ShiftNotesSection`'s merged `useLiveQuery` renders it immediately with
a "Pending sync" chip — no network round-trip in the critical path at all. The worker keeps
working; the `OfflineBanner` stays visible. Connectivity returns → the `'online'` event fires →
`OutboxSyncer` flushes the row: `POST /portal/shifts/{id}/notes` with `Idempotency-Key:
<row.id>`. `IdempotentAttribute` sees no stored row for that key (first real attempt), executes
`CreateShiftNote`, gets 200, stores the key. The syncer deletes the outbox row and invalidates
the query key; the note flips from the local "Pending sync" chip to the server's real
`ShiftNoteDto` row on the next fetch — same visual position in the merged list, since outbox
rows render first and this row simply disappears from that half of the merge as it appears in
the server half.

**Retried flush after a dropped response.** The syncer's POST above succeeds server-side, but the
response never reaches the browser (connection drops mid-response). The syncer sees a network
error, increments `attempts`, and leaves the row `pending` for the next trigger. Ten seconds
later the 60 s interval (or the next `'online'`/focus event) fires the *same* row with the
*same* `Idempotency-Key`. `IdempotentAttribute` now finds a stored row, same `UserId`, same
`RequestHash` → replays the original 200 body with `Idempotent-Replayed: true`. The syncer treats
this identically to a fresh 2xx: deletes the row, invalidates the query. Exactly one `ShiftNote`
ever exists for this worker's text, despite two physical POSTs reaching the server.

## Error handling

| Scenario | Result |
|---|---|
| Compose while `navigator.onLine === false` | Written to outbox, rendered with "Pending sync" chip, no network call |
| Online POST fails with a network error (`!error.response`) | Written to outbox identically to the offline case |
| Online POST returns a 4xx/5xx *response* | Surfaced via the existing inline error message in `ShiftNotesSection.tsx` — never written to the outbox, since a real server answer (validation failure, etc.) would just fail again identically on retry |
| Retried key, same body hash | 200, `Idempotent-Replayed: true` — treated as success |
| Retried key, different body hash (should not occur — see §3) | 422 `IDEMPOTENCY_KEY_REUSED` — row marked `'failed'` |
| Key belongs to another user | 404 — row marked `'failed'`, generic "couldn't sync" message (this case can only arise from a corrupted/shared outbox, which the user-switch wipe (§2) is designed to prevent in the first place) |
| Shift reassigned away from the worker while offline (note POST 404s from `PortalController`'s ownership check) | Row marked `'failed'`, `lastError = "This shift is no longer assigned to you."`, Discard action only (no Retry — this can't self-heal) |
| Token expired during a flush (401) | The existing `client.ts` refresh interceptor runs first; if it succeeds the retried request proceeds normally and the syncer never sees the 401 directly; if refresh fails, the interceptor's own `logout()` fires and the syncer's flush pass simply stops — next login re-triggers a flush |
| `QuotaExceededError` writing to Dexie | `Toast` shown ("device storage is full"); composer keeps its typed text so the worker can retry after freeing space |
| A different user logs in with pending outbox rows present | `ConfirmDialog` — "N unsynced notes from another account will be discarded." — confirm wipes both Dexie tables before continuing; decline leaves the previous session's rows in place and blocks proceeding as the new user until resolved (the login flow itself is untouched by this spec; the confirm gate sits in the syncer's post-login hook, not in `LoginPage.tsx`) |
| `attempts` reaches 20 on any row | Marked `'failed'` regardless of the specific underlying error, `lastError = "Sync failed after 20 attempts."` |

## Out of scope / explicitly deferred

- **Offline Start/Finish.** Belongs to `docs/specs/2026-09-08-shift-completion-design.md`, whose
  own Out of scope section already defers this to "a future PWA spec" — this spec is that
  follow-up, and it deliberately picks up only note creation, not the state-machine actions.
- **Offline reads of anything but the worker's own shifts/notes.** No other portal or office
  page gets a runtime-caching rule; a worker with no connectivity sees a blank/error state on
  witness approvals, leave, and every non-portal page exactly as today.
- **Photo/file attachments on shift notes.** `CreateShiftNoteDto` is text-only today and stays
  that way; the outbox schema has no attachment column, and offline photo capture + upload
  queuing is a materially larger feature (binary storage quota, upload progress, retry-with-
  large-payload semantics) than this spec's scope.
- **AI note drafting.** Deferred entirely, not partially. What it would be: a server-side LLM
  call that turns a worker's bullet points into a compliant, well-formed progress note, gated
  behind a per-tenant setting, with the generated draft always left editable in the composer
  before save — never auto-submitted. Why it's deferred: it needs a privacy review before any
  participant-identifying clinical text leaves the tenant's boundary to an external model
  provider, and — per this repo's own architecture notes — there is no LLM infrastructure
  anywhere in the stack today to build it on top of. Both are separate pieces of work from
  making note-taking itself resilient to a dropped connection, which is this spec's actual goal.
- **Push notifications.** No push subscription flow, no `PushManager` registration — the
  "Update available" toast and offline banner are both purely in-page/foreground UI, not
  background push.
- **Conflict resolution for edits.** The outbox is append-only — creating a new note offline is
  supported; editing an existing note (`useUpdateShiftNote`) stays online-only, since a
  conflicting concurrent edit (worker edits offline, coordinator or the worker on another device
  edits the same note online first) has no defined resolution in this design and isn't worth
  inventing one for a compliance-adjacent record without a product decision.
- **Generic idempotency for all POSTs.** `IdempotentAttribute` is applied opt-in, per action —
  there is no ambition here to make every mutating endpoint idempotent; that would be a much
  larger, separately-scoped change touching dozens of controllers.

## Testing

**Backend (`Odip.Tests`)**, inline in-memory `OdipDbContext` fixture with a Moq'd
`ICurrentTenant`, following the existing `StaffAssignmentGateTests.CreateDb` pattern (no shared
base class — Context, above, and confirmed by every sibling spec's own testing section):

- `Filters/IdempotentAttributeTests` — pass-through with no header present; first-request
  store-then-replay round trip (call twice with the same key/body, assert the second is a
  literal byte-for-byte replay of the first's response plus the `Idempotent-Replayed` header);
  different-hash same-key → 422 `IDEMPOTENCY_KEY_REUSED`; same-key different-user → 404;
  expiry sweep (seed an old row, assert it's gone after the next idempotent request); concurrent-
  insert race (pre-insert a row to simulate the loser-catches-unique-violation path, assert it
  replays rather than erroring).
- `Portal/PortalCreateShiftNoteIdempotencyTests` — end-to-end through `PortalController`
  itself (not just the filter in isolation): the header wired onto the real action, confirming
  the filter and controller compose correctly.

**Frontend** — co-located `*.test.tsx`, mocking `@/api/hooks` with `vi.hoisted` per the
`PortalShiftsPage.test.tsx` precedent (Context, above — no MSW/network-level mocking in this
codebase). `fake-indexeddb` added as a new `devDependency` so Dexie has a working IndexedDB
implementation under jsdom (Vitest's `environment: 'jsdom'` has no native IndexedDB) — imported
once in `src/test/setup.ts` alongside the existing `@testing-library/jest-dom/vitest` import.

- `lib/outboxSyncer.test.ts` — flush ordering (oldest first), the `Idempotency-Key` header on
  each request, every branch of the outcome table in §2 (2xx, replayed-2xx, network error, 401,
  404-reassigned, other 4xx, 20-attempt cap), and the interval only running while pending rows
  exist.
- `pages/portal/components/ShiftNotesSection.test.tsx` additions — outbox row rendering with the
  "Pending sync" chip merged ahead of server rows, offline compose writing to the outbox instead
  of calling the mocked `useCreateShiftNote`, Retry/Discard actions on a `'failed'` row.
- `components/OfflineBanner.test.tsx` — shows/hides on `window` `'online'`/`'offline'` events.
- `lib/offlineDb.test.ts` — user-switch wipe (with and without pending rows, confirm-dialog
  gating), quota-exceeded handling leaves the composer's text intact.

Service-worker/Workbox configuration itself is not unit-tested (Vitest has no way to exercise a
built service worker in a meaningful way) — verified instead by a manual checklist attached to
the PR: a Lighthouse PWA audit passes on the built `dist/` output, and an airplane-mode
note-round-trip is performed by hand on both Android Chrome (exercising the Background Sync
accelerator) and iOS Safari (exercising the in-page-only path, per §2's Safari caveat).

## Delivery

Two PRs. PR 2 depends on PR 1 — the outbox syncer's replay-handling logic assumes the
`Idempotent-Replayed` header semantics PR 1 introduces.

1. **Backend idempotency.** `IdempotencyKey` entity + `OdipDbContext` configuration, migration
   `AddIdempotencyKeys`, `Filters/IdempotentAttribute.cs` applied to
   `PortalController.CreateShiftNote`, the `Idempotency:RetentionHours` config read, all backend
   tests above, `mock-api/server.js`'s dispatch-loop header-passing change + the new
   `portal/shifts/:id/notes` handler.
2. **Frontend PWA + offline outbox.** `vite-plugin-pwa` install/config (manifest, Workbox
   runtime-caching rules, `devOptions`/Vitest guard), generated icons under `frontend/public/
   icons/`, the two new `nginx/default.conf` location blocks, `dexie`/`dexie-react-hooks`/
   `fake-indexeddb` install, `lib/offlineDb.ts`, `lib/outboxSyncer.ts` started from `main.tsx`,
   the `useCreateShiftNote` wrapper, `ShiftNotesSection.tsx` merged-rendering + Retry/Discard,
   `components/Toast.tsx` (new — update-available, quota-exceeded), `components/OfflineBanner.tsx`
   (new), the third `NavCountBadge` on `AppLayout.tsx`'s "My Shifts" entry, all frontend tests
   above.

## Open questions

1. **Device-theft / unlocked-browser residual risk.** The 24h Cache-Storage PII exposure and the
   Dexie outbox itself both persist participant-identifying text on the device between syncs.
   This design's mitigations (self-scoping, 24h expiry, logout-clears-caches) reduce but don't
   eliminate the risk of a stolen or briefly-unlocked device. Recommendation: this is a device
   policy question (organisation-issued devices with OS-level screen lock enforced, MDM, or a
   documented "don't leave the portal open unattended" policy), not something further app code
   can close — flagged here rather than silently left unaddressed.
2. **Should the portal require a device PIN/lock as a condition of installing the PWA?** Related
   to (1) but a distinct product decision — e.g. gating the "Add to Home Screen" prompt behind an
   acknowledgement that the device has a lock screen configured. Not addressed by this design;
   raised for whoever schedules the rollout to decide.
3. **Should iOS "Add to Home Screen" instructions be shown in-app?** iOS Safari has no
   `beforeinstallprompt` event — there's no programmatic install prompt to hook a button to the
   way Chromium supports. Whether the portal should show its own "how to install" walkthrough for
   iOS users (a small, self-contained addition, but genuinely optional relative to the offline
   note-taking goal itself) is left as a scope call rather than assumed.
